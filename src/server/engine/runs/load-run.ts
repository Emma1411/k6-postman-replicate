import "server-only";
import { randomUUID } from "node:crypto";
import { getPeakVus, getTotalDurationSeconds } from "@/server/config/enforce-limits";
import type { Limits } from "@/server/config/limits";
import { sleep, sleepUntil } from "@/server/engine/executors/timing";
import { MetricsAggregator } from "@/server/engine/metrics/aggregator";
import { round2 } from "@/server/engine/metrics/round";
import {
  evaluateThresholds,
  parseThresholds,
  shouldAbort,
  type ParsedThreshold,
} from "@/server/engine/thresholds/thresholds";
import type { LoopStats, MainToWorker, WorkerToMain } from "@/server/engine/workers/protocol";
import type { ExecutorConfig, LoadScenario } from "@/shared/schemas";
import type {
  GeneratorStatus,
  GeneratorSummary,
  LoadEvent,
  LoadRunInfo,
  LoadRunResult,
  RunState,
  ThresholdResult,
} from "@/shared/types/load-result";

const START_DELAY_MS = 300;
const READY_TIMEOUT_MS = 15_000;
const FLUSH_TIMEOUT_MS = 500;
const STOP_WAIT_MS = 15_000;
const HARD_MARGIN_SECONDS = 20;
/** Un retard de boucle d'événements (p99) au-dessus de ce seuil fausse les latences mesurées. */
const SATURATION_P99_MS = 50;

export type AbortKind = "cancelled" | "detached" | "threshold" | "timeout" | "error";

export interface WorkerLike {
  postMessage(message: MainToWorker): void;
  on(event: "message", listener: (message: WorkerToMain) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  terminate(): Promise<unknown>;
}

export interface LoadRunDeps {
  limits: Limits;
  createWorker: (index: number) => WorkerLike;
  maxWorkers: number;
  detachGraceMs: number;
  gracefulStopMs: number;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface WorkerSlot {
  index: number;
  worker: WorkerLike;
  ready: Deferred;
  done: Deferred;
  isDone: boolean;
  flushWaiters: Map<number, () => void>;
}

/** Nombre de workers : jamais plus que de VUs possibles ni que le maximum autorisé. */
export function chooseWorkerCount(executor: ExecutorConfig, maxWorkers: number): number {
  return Math.max(1, Math.min(maxWorkers, getPeakVus(executor)));
}

class GeneratorTracker {
  private windowP99 = 0;
  private windowMax = 0;
  private saturatedWindows = 0;
  private maxLoopDelay = 0;
  private last: GeneratorStatus = { loopDelayP99Ms: 0, loopDelayMaxMs: 0, saturated: false };

  record(loop: LoopStats): void {
    this.windowP99 = Math.max(this.windowP99, loop.p99Ms);
    this.windowMax = Math.max(this.windowMax, loop.maxMs);
  }

  closeWindow(): GeneratorStatus {
    const saturated = this.windowP99 >= SATURATION_P99_MS;
    if (saturated) this.saturatedWindows++;
    this.maxLoopDelay = Math.max(this.maxLoopDelay, this.windowMax);
    this.last = {
      loopDelayP99Ms: round2(this.windowP99),
      loopDelayMaxMs: round2(this.windowMax),
      saturated,
    };
    this.windowP99 = 0;
    this.windowMax = 0;
    return this.last;
  }

  status(): GeneratorStatus {
    return this.last;
  }

  summary(workers: number): GeneratorSummary {
    return {
      saturated: this.saturatedWindows > 0,
      saturatedWindows: this.saturatedWindows,
      maxLoopDelayMs: round2(this.maxLoopDelay),
      workers,
    };
  }
}

/** Un test de charge : pilote les workers, fusionne leurs métriques et diffuse les événements. */
export class LoadRun {
  readonly id = randomUUID();
  readonly finished: Promise<LoadRunResult>;

  private readonly scenario: LoadScenario;
  private readonly deps: LoadRunDeps;
  private readonly thresholds: ParsedThreshold[];
  private readonly aggregator = new MetricsAggregator();
  private readonly generator = new GeneratorTracker();
  private readonly listeners = new Set<(event: LoadEvent) => void>();
  private readonly workerCount: number;
  private readonly plannedSeconds: number;
  private resolveFinished!: (result: LoadRunResult) => void;

  private workers: WorkerSlot[] = [];
  private state: RunState = "starting";
  private startAtMs = 0;
  private lastCloseAt = 0;
  private abortKind: AbortKind | null = null;
  private abortReason: string | null = null;
  private failure: Error | null = null;
  private latestThresholds: ThresholdResult[] = [];
  private result: LoadRunResult | null = null;
  private detachTimer: NodeJS.Timeout | null = null;

  constructor(scenario: LoadScenario, deps: LoadRunDeps) {
    this.scenario = scenario;
    this.deps = deps;
    this.thresholds = parseThresholds(scenario.thresholds);
    this.workerCount = chooseWorkerCount(scenario.executor, deps.maxWorkers);
    this.plannedSeconds = getTotalDurationSeconds(scenario.executor);
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
    this.scheduleDetach();
  }

  get isFinished(): boolean {
    return this.state === "finished";
  }

  start(): void {
    void this.execute().then((result) => this.resolveFinished(result));
  }

  info(): LoadRunInfo {
    return {
      runId: this.id,
      name: this.scenario.name,
      executorType: this.scenario.executor.type,
      workers: this.workerCount,
      plannedDurationSeconds: this.plannedSeconds,
      startedAt: this.startAtMs > 0 ? this.startAtMs : null,
      state: this.state,
    };
  }

  /** Photo complète de l'état courant : envoyée à chaque nouveau client (y compris après un rechargement). */
  initEvent(): LoadEvent {
    const points = [...this.aggregator.getPoints()];
    return {
      type: "init",
      run: this.info(),
      points,
      snapshot: points.length > 0 ? this.aggregator.snapshot() : null,
      thresholds: this.latestThresholds,
      generator: this.generator.status(),
      result: this.result,
    };
  }

  subscribe(listener: (event: LoadEvent) => void): () => void {
    this.listeners.add(listener);
    this.clearDetach();
    return () => {
      this.listeners.delete(listener);
      this.scheduleDetach();
    };
  }

  /** Demande l'arrêt. Sans effet si le test est déjà en train de s'arrêter ou terminé. */
  cancel(reason: string, kind: AbortKind = "cancelled"): void {
    if (this.state === "finished" || this.abortKind !== null) return;
    this.abortKind = kind;
    this.abortReason = reason;
    this.state = "stopping";
    for (const slot of this.workers) if (!slot.isDone) slot.worker.postMessage({ type: "abort" });
    this.emit({ type: "stopping", reason });
  }

  // --- exécution ---------------------------------------------------------------------------------

  private async execute(): Promise<LoadRunResult> {
    try {
      await this.runWorkers();
    } catch (err) {
      this.failure ??= err instanceof Error ? err : new Error(String(err));
    } finally {
      await Promise.allSettled(this.workers.map((slot) => slot.worker.terminate()));
    }
    return this.finalize();
  }

  private async runWorkers(): Promise<void> {
    this.workers = Array.from({ length: this.workerCount }, (_, index) => this.spawn(index));

    await withTimeout(
      Promise.all(this.workers.map((slot) => slot.ready.promise)),
      READY_TIMEOUT_MS,
      "Les workers de charge n'ont pas démarré à temps.",
    );
    if (this.failure) return;

    this.startAtMs = Date.now() + START_DELAY_MS;
    this.lastCloseAt = this.startAtMs;
    const gracefulStopMs = this.deps.gracefulStopMs;
    for (const slot of this.workers) {
      slot.worker.postMessage({
        type: "start",
        config: {
          workerIndex: slot.index,
          workerCount: this.workerCount,
          scenario: this.scenario,
          startAtMs: this.startAtMs,
          limits: this.deps.limits,
          gracefulStopMs,
        },
      });
    }
    if (this.state === "starting") this.state = "running";
    this.emit({ type: "started", run: this.info() });

    await this.tickLoop();
  }

  private spawn(index: number): WorkerSlot {
    const worker = this.deps.createWorker(index);
    const slot: WorkerSlot = {
      index,
      worker,
      ready: deferred(),
      done: deferred(),
      isDone: false,
      flushWaiters: new Map(),
    };
    worker.on("message", (message) => this.onMessage(slot, message));
    worker.on("error", (err) => this.onWorkerFailure(slot, err));
    worker.on("exit", (code) => {
      if (!slot.isDone && this.state !== "finished") {
        this.onWorkerFailure(slot, new Error(`Le worker ${index} s'est arrêté de façon inattendue (code ${code}).`));
      }
    });
    return slot;
  }

  private onMessage(slot: WorkerSlot, message: WorkerToMain): void {
    switch (message.type) {
      case "ready":
        slot.ready.resolve();
        break;
      case "delta":
        this.aggregator.addDelta(slot.index, message.delta);
        this.generator.record(message.loop);
        slot.flushWaiters.get(message.seq)?.();
        slot.flushWaiters.delete(message.seq);
        break;
      case "done":
        this.aggregator.addDelta(slot.index, message.delta);
        this.generator.record(message.loop);
        this.markDone(slot);
        break;
      case "error":
        this.failure ??= new Error(message.message);
        this.cancel("Erreur dans un worker de charge.", "error");
        break;
    }
  }

  private onWorkerFailure(slot: WorkerSlot, err: Error): void {
    this.failure ??= err;
    this.markDone(slot);
    this.cancel("Erreur dans un worker de charge.", "error");
  }

  private markDone(slot: WorkerSlot): void {
    slot.isDone = true;
    slot.ready.resolve();
    slot.done.resolve();
    for (const resolve of slot.flushWaiters.values()) resolve();
    slot.flushWaiters.clear();
  }

  /** Une fois par seconde : demande les métriques aux workers, clôt la fenêtre, évalue les thresholds. */
  private async tickLoop(): Promise<void> {
    const allDone = Promise.all(this.workers.map((slot) => slot.done.promise)).then(() => undefined);
    let finished = false;
    void allDone.then(() => {
      finished = true;
    });

    const hardDeadline =
      this.startAtMs + (this.plannedSeconds + this.deps.gracefulStopMs / 1000 + HARD_MARGIN_SECONDS) * 1000;
    let nextTick = this.startAtMs + 1000;
    let stopDeadline: number | null = null;
    let seq = 0;

    while (!finished) {
      const wake = new AbortController();
      await Promise.race([sleepUntil(nextTick, wake.signal), allDone]);
      wake.abort();
      if (finished) break;

      await this.collectWindow(++seq);

      nextTick += 1000;
      while (nextTick <= Date.now()) nextTick += 1000; // en retard : on se recale sur la grille

      const now = Date.now();
      if (now > hardDeadline) this.cancel("Durée maximale dépassée.", "timeout");
      if (this.abortKind !== null) {
        stopDeadline ??= now + STOP_WAIT_MS;
        if (now > stopDeadline) break;
      }
    }

    this.closeAndEmit(); // dernière fenêtre, souvent partielle
  }

  private async collectWindow(seq: number): Promise<void> {
    const waiting = this.workers.filter((slot) => !slot.isDone);
    const responses = waiting.map(
      (slot) =>
        new Promise<void>((resolve) => {
          slot.flushWaiters.set(seq, resolve);
          slot.worker.postMessage({ type: "flush", seq });
        }),
    );

    // Un worker saturé peut répondre en retard : sa fenêtre sera simplement comptée dans la suivante.
    const cancelWait = new AbortController();
    await Promise.race([Promise.all(responses), sleep(FLUSH_TIMEOUT_MS, cancelWait.signal)]);
    cancelWait.abort();
    for (const slot of waiting) slot.flushWaiters.delete(seq);

    this.closeAndEmit();
  }

  private closeAndEmit(): void {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, (now - this.startAtMs) / 1000);
    const windowSeconds = Math.max(0.2, (now - this.lastCloseAt) / 1000);
    this.lastCloseAt = now;

    const point = this.aggregator.closeWindow(elapsedSeconds, windowSeconds);
    const results = evaluateThresholds(this.thresholds, this.aggregator, false);
    this.latestThresholds = results;
    const generator = this.generator.closeWindow();

    this.emit({ type: "window", point, snapshot: this.aggregator.snapshot(), thresholds: results, generator });

    const failing = shouldAbort(results, this.thresholds, elapsedSeconds);
    if (failing) this.cancel(`Threshold non respecté : ${failing.metric} ${failing.expression}`, "threshold");
  }

  private finalize(): LoadRunResult {
    this.clearDetach();

    const snapshot = this.aggregator.snapshot();
    const thresholds = evaluateThresholds(this.thresholds, this.aggregator, true);
    const thresholdsPassed = thresholds.every((t) => t.passed);

    let status: LoadRunResult["status"];
    if (this.failure || this.abortKind === "error") status = "error";
    else if (this.abortKind === "cancelled" || this.abortKind === "detached" || this.abortKind === "timeout") {
      status = "aborted";
    } else status = thresholdsPassed ? "passed" : "failed";

    const result: LoadRunResult = {
      runId: this.id,
      name: this.scenario.name,
      status,
      abortReason: this.abortReason,
      error: this.failure?.message ?? null,
      durationSeconds: this.startAtMs > 0 ? round2(Math.max(0, (Date.now() - this.startAtMs) / 1000)) : 0,
      snapshot,
      thresholds,
      thresholdsPassed,
      generator: this.generator.summary(this.workerCount),
    };

    this.result = result;
    this.latestThresholds = thresholds;
    this.state = "finished";
    this.emit({ type: "finished", result });
    return result;
  }

  // --- diffusion et abonnés ----------------------------------------------------------------------

  private emit(event: LoadEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        /* un abonné défaillant ne doit jamais perturber le test */
      }
    }
  }

  /** Sans abonné pendant un délai, le test est annulé : on ne laisse pas tourner une charge que personne ne suit. */
  private scheduleDetach(): void {
    if (this.listeners.size > 0 || this.state === "finished" || this.detachTimer) return;
    this.detachTimer = setTimeout(
      () => this.cancel("Aucun client connecté : test annulé.", "detached"),
      this.deps.detachGraceMs,
    );
    this.detachTimer.unref?.();
  }

  private clearDetach(): void {
    if (this.detachTimer) clearTimeout(this.detachTimer);
    this.detachTimer = null;
  }
}