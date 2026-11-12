import type { ExecutorConfig } from "@/shared/schemas";
import { ArrivalSchedule, ownedVuCount, rampingTarget, totalStagesSeconds } from "./schedule";
import { sleep, sleepUntil } from "./timing";
import type { ExecutorRun } from "./types";
import { VuLoops } from "./vu-loops";

const DEFAULT_GRACEFUL_STOP_MS = 10_000;
const TICK_MS = 100;

/**
 * Attend la fin des itérations en cours. Au-delà du délai d'arrêt progressif,
 * annule tout (les requêtes en cours sont interrompues).
 */
async function drain(run: ExecutorRun, idle: Promise<void>): Promise<void> {
  const cancelWait = new AbortController();
  const finished = await Promise.race([
    idle.then(() => true),
    sleep(run.gracefulStopMs ?? DEFAULT_GRACEFUL_STOP_MS, cancelWait.signal).then(() => false),
  ]);
  cancelWait.abort();

  if (!finished) {
    run.controller.abort();
    await idle;
  }
  run.recorder.setVus(0);
}

function newLoops(run: ExecutorRun, extra: { iterationLimit?: number; claim?: () => boolean } = {}): VuLoops {
  return new VuLoops({
    runIteration: run.runIteration,
    signal: run.controller.signal,
    shareIndex: run.shareIndex,
    shareCount: run.shareCount,
    ...extra,
  });
}

async function runConstantVus(run: ExecutorRun, e: Extract<ExecutorConfig, { type: "constant-vus" }>): Promise<void> {
  const { signal } = run.controller;
  const loops = newLoops(run);
  loops.scaleTo(ownedVuCount(e.vus, run.shareIndex, run.shareCount));
  run.recorder.setVus(loops.active);

  await sleepUntil(run.startAtMs + e.durationSeconds * 1000, signal);
  loops.stopAll();
  await drain(run, loops.idle());
}

async function runRampingVus(run: ExecutorRun, e: Extract<ExecutorConfig, { type: "ramping-vus" }>): Promise<void> {
  const { signal } = run.controller;
  const total = totalStagesSeconds(e.stages);
  const loops = newLoops(run);

  while (!signal.aborted) {
    const t = (Date.now() - run.startAtMs) / 1000;
    if (t >= total) break;

    const target = Math.round(rampingTarget(e.startVus, e.stages, t));
    loops.scaleTo(ownedVuCount(target, run.shareIndex, run.shareCount));
    run.recorder.setVus(loops.active);
    await sleep(Math.min(TICK_MS, Math.max(1, (total - t) * 1000)), signal);
  }

  loops.stopAll();
  await drain(run, loops.idle());
}

async function runArrival(
  run: ExecutorRun,
  schedule: ArrivalSchedule,
  preAllocatedVus: number,
  maxVus: number,
): Promise<void> {
  const { signal } = run.controller;
  const { shareIndex: index, shareCount: count } = run;

  // Part de ce worker dans le pool de VUs.
  const maxShare = Math.max(1, Math.ceil(maxVus / count));
  let initialized = Math.min(maxShare, Math.ceil(preAllocatedVus / count));
  run.recorder.setVus(initialized);

  const freeSlots: number[] = [];
  const running = new Set<Promise<void>>();
  let nextSlot = 0;
  let inFlight = 0;
  let counter = 0;
  let sinceYield = 0;

  while (!signal.aborted) {
    const due = schedule.next();
    if (due === null) break;
    const iteration = ++counter;
    if ((iteration - 1) % count !== index) continue; // itération d'un autre worker

    const wait = run.startAtMs + due * 1000 - Date.now();
    if (wait > 0) {
      await sleep(wait, signal);
      sinceYield = 0;
    } else if (++sinceYield >= 32) {
      // En retard : on rattrape, mais en laissant respirer la boucle d'événements.
      await sleep(0, signal);
      sinceYield = 0;
    }
    if (signal.aborted) break;

    if (inFlight >= maxShare) {
      run.recorder.recordDropped(1);
      continue;
    }

    const slot = freeSlots.pop() ?? nextSlot++;
    inFlight++;
    if (inFlight > initialized) {
      initialized = inFlight;
      run.recorder.setVus(initialized);
    }

    const task: Promise<void> = run
      .runIteration({ vu: slot * count + index + 1, iteration })
      .catch(() => undefined)
      .then(() => {
        inFlight--;
        freeSlots.push(slot);
        running.delete(task);
      });
    running.add(task);
  }

  await drain(run, Promise.all(running).then(() => undefined));
}

/** Attend que les boucles soient finies, ou l'échéance (maxDuration) si elle arrive avant. */
async function waitIdleOrDeadline(idle: Promise<void>, deadlineMs: number): Promise<void> {
  const cancel = new AbortController();
  await Promise.race([idle, sleepUntil(deadlineMs, cancel.signal)]);
  cancel.abort();
}

async function runPerVuIterations(
  run: ExecutorRun,
  e: Extract<ExecutorConfig, { type: "per-vu-iterations" }>,
): Promise<void> {
  const loops = newLoops(run, { iterationLimit: e.iterations });
  loops.scaleTo(ownedVuCount(e.vus, run.shareIndex, run.shareCount));
  run.recorder.setVus(loops.active);

  await waitIdleOrDeadline(loops.idle(), run.startAtMs + e.maxDurationSeconds * 1000);
  loops.stopAll();
  await drain(run, loops.idle());
}

async function runSharedIterations(
  run: ExecutorRun,
  e: Extract<ExecutorConfig, { type: "shared-iterations" }>,
): Promise<void> {
  // Les itérations sont réparties entre les workers qui possèdent au moins un VU.
  const owners = Math.min(e.vus, run.shareCount);
  const quota =
    run.shareIndex < owners
      ? Math.floor(e.iterations / owners) + (run.shareIndex < e.iterations % owners ? 1 : 0)
      : 0;
  let remaining = quota;

  const loops = newLoops(run, { claim: () => remaining-- > 0 });
  loops.scaleTo(ownedVuCount(e.vus, run.shareIndex, run.shareCount));
  run.recorder.setVus(loops.active);

  await waitIdleOrDeadline(loops.idle(), run.startAtMs + e.maxDurationSeconds * 1000);
  loops.stopAll();
  await drain(run, loops.idle());
}

/** Exécute la part de ce worker pour l'executor demandé. Se termine quand le test est fini. */
export async function runExecutor(run: ExecutorRun): Promise<void> {
  await sleepUntil(run.startAtMs, run.controller.signal);
  const e = run.executor;

  switch (e.type) {
    case "constant-vus":
      return runConstantVus(run, e);
    case "ramping-vus":
      return runRampingVus(run, e);
    case "constant-arrival-rate":
      return runArrival(run, ArrivalSchedule.constant(e.rate, e.timeUnitSeconds, e.durationSeconds), e.preAllocatedVus, e.maxVus);
    case "ramping-arrival-rate":
      return runArrival(run, new ArrivalSchedule(e.startRate, e.stages, e.timeUnitSeconds), e.preAllocatedVus, e.maxVus);
    case "per-vu-iterations":
      return runPerVuIterations(run, e);
    case "shared-iterations":
      return runSharedIterations(run, e);
  }
}