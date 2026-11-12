import "server-only";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Dispatcher } from "undici";
import { runExecutor } from "@/server/engine/executors/run-executor";
import { MetricsRecorder } from "@/server/engine/metrics/recorder";
import { createIterationRunner } from "@/server/engine/runner/iteration-runner";
import { createLoadDispatcher, createLoadTransport } from "@/server/engine/transport/load-transport";
import type { LoopStats, MainToWorker, WorkerConfig, WorkerToMain } from "./protocol";

/**
 * Logique d'un worker, indépendante de worker_threads : elle reçoit des messages et en émet via `post`.
 * Le vrai worker (load-worker.ts) la branche sur parentPort ; les tests la font tourner dans le même thread.
 */
export function createWorkerRuntime(post: (message: WorkerToMain) => void) {
  const recorder = new MetricsRecorder();
  const controller = new AbortController();
  const loopMonitor = monitorEventLoopDelay({ resolution: 10 });
  let started = false;
  let dispatcher: Dispatcher | null = null;

  function takeLoopStats(): LoopStats {
    const hasSamples = loopMonitor.count > 0;
    const stats = {
      p99Ms: hasSamples ? loopMonitor.percentile(99) / 1e6 : 0,
      maxMs: hasSamples ? loopMonitor.max / 1e6 : 0,
    };
    loopMonitor.reset();
    return stats;
  }

  async function start(config: WorkerConfig): Promise<void> {
    if (started) return;
    started = true;

    try {
      // Si l'annulation est arrivée avant le démarrage, on ne lance rien.
      if (!controller.signal.aborted) {
        dispatcher = createLoadDispatcher(config.limits);
        const transport = createLoadTransport({
          limits: config.limits,
          dispatcher,
          recorder,
          signal: controller.signal,
        });
        const runIteration = createIterationRunner({
          workflow: config.scenario.workflow,
          transport,
          recorder,
          signal: controller.signal,
        });

        loopMonitor.enable();
        await runExecutor({
          executor: config.scenario.executor,
          startAtMs: config.startAtMs,
          shareIndex: config.workerIndex,
          shareCount: config.workerCount,
          runIteration,
          recorder: {
            setVus: (n) => recorder.setVus(n),
            recordDropped: (n) => recorder.recordDropped(n),
          },
          controller,
          gracefulStopMs: config.gracefulStopMs,
        });
      }
    } catch (err) {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      post({ type: "done", delta: recorder.flush(), loop: takeLoopStats() });
      loopMonitor.disable();
      await dispatcher?.destroy().catch(() => undefined);
    }
  }

  function handle(message: MainToWorker): void {
    switch (message.type) {
      case "start":
        void start(message.config);
        break;
      case "flush":
        post({ type: "delta", seq: message.seq, delta: recorder.flush(), loop: takeLoopStats() });
        break;
      case "abort":
        controller.abort();
        break;
    }
  }

  function dispose(): void {
    controller.abort();
    loopMonitor.disable();
  }

  return { handle, dispose };
}