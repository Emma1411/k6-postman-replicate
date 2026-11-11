import "server-only";
import { performance } from "node:perf_hooks";
import type { Variables, Workflow, WorkflowStep } from "@/shared/schemas";
import type { StepResult, StepStatus, WorkflowRunResult } from "@/shared/types/workflow-result";
import type { StepTransport } from "@/server/engine/types";
import { evaluateCondition } from "./conditions";
import { runStep } from "./run-step";

export interface RunWorkflowOptions {
  transport: StepTransport;
  /** Variables d'environnement : elles remplacent celles du workflow. */
  variables?: Variables;
  vu?: number;
  iteration?: number;
  includePreview?: boolean;
  /** Échéance globale, en Date.now(). */
  deadlineAt?: number;
  signal?: AbortSignal;
  /** Injectable pour les tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function skipped(step: WorkflowStep, reason: string): StepResult {
  return {
    stepId: step.id,
    name: step.name,
    status: "skipped",
    skippedReason: reason,
    response: null,
    assertions: [],
    extracted: {},
    extractionErrors: [],
    error: null,
  };
}

export async function runWorkflow(workflow: Workflow, options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const startedAt = performance.now();
  const sleep = options.sleep ?? defaultSleep;
  const scope: Variables = { ...workflow.variables, ...options.variables };
  const results: StepResult[] = [];
  let stoppedAt: string | null = null;
  let aborted = false;

  const isOver = () =>
    options.signal?.aborted === true || (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt);

  for (const step of workflow.steps) {
    if (stoppedAt !== null) {
      results.push(skipped(step, "Arrêté après un échec ou une erreur."));
      continue;
    }
    if (aborted || isOver()) {
      aborted = true;
      results.push(skipped(step, "Exécution interrompue (délai dépassé ou annulation)."));
      continue;
    }
    if (step.runIf && !evaluateCondition(step.runIf, scope)) {
      results.push(skipped(step, "Condition d'exécution non remplie."));
      continue;
    }

    const remainingMs = options.deadlineAt === undefined ? null : Math.max(1, options.deadlineAt - Date.now());
    const result = await runStep(step, {
      transport: options.transport,
      variables: scope,
      vu: options.vu ?? 1,
      iteration: options.iteration ?? 1,
      remainingMs,
      includePreview: options.includePreview ?? false,
    });
    results.push(result);
    Object.assign(scope, result.extracted);

    if ((result.status === "failed" || result.status === "error") && step.onError === "stop") {
      stoppedAt = step.id;
      continue;
    }

    if (step.thinkTimeMs > 0) {
      const left = options.deadlineAt === undefined ? step.thinkTimeMs : options.deadlineAt - Date.now();
      await sleep(Math.max(0, Math.min(step.thinkTimeMs, left)), options.signal);
    }
  }

  const count = (status: StepStatus) => results.filter((r) => r.status === status).length;
  const allAssertions = results.flatMap((r) => r.assertions);
  const summary = {
    steps: results.length,
    passed: count("passed"),
    failed: count("failed"),
    errors: count("error"),
    skipped: count("skipped"),
    assertionsPassed: allAssertions.filter((a) => a.passed).length,
    assertionsFailed: allAssertions.filter((a) => !a.passed).length,
  };

  return {
    workflow: workflow.name,
    status: summary.failed > 0 || summary.errors > 0 || aborted ? "failed" : "passed",
    stoppedAtStepId: stoppedAt,
    aborted,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    summary,
    steps: results,
    variables: { ...scope },
  };
}