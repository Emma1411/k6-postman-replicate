import "server-only";
import type { Workflow } from "@/shared/schemas";
import type { IterationFn } from "@/server/engine/executors/types";
import type { MetricsRecorder } from "@/server/engine/metrics/recorder";
import type { StepTransport } from "@/server/engine/types";
import { runWorkflow } from "@/server/engine/vu/run-workflow";

export interface IterationRunnerDeps {
  workflow: Workflow;
  transport: StepTransport;
  recorder: Pick<MetricsRecorder, "recordChecks" | "recordIteration">;
  signal: AbortSignal;
}

/**
 * Une itération = un passage complet du workflow. Les assertions et les extractions alimentent
 * la métrique `checks` ; la durée (pauses comprises) alimente `iteration_duration`.
 * Une itération interrompue par l'arrêt du test n'est pas comptée.
 */
export function createIterationRunner(deps: IterationRunnerDeps): IterationFn {
  return async ({ vu, iteration }) => {
    const result = await runWorkflow(deps.workflow, {
      transport: deps.transport,
      vu,
      iteration,
      signal: deps.signal,
    });
    if (result.aborted || deps.signal.aborted) return;

    let passed = 0;
    let failed = 0;
    for (const step of result.steps) {
      for (const assertion of step.assertions) {
        if (assertion.passed) passed++;
        else failed++;
      }
      failed += step.extractionErrors.length;
    }
    deps.recorder.recordChecks(passed, failed);
    deps.recorder.recordIteration(result.durationMs);
  };
}