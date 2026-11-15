import type { StepResult, StepStatus, WorkflowRunResult } from "@/shared/types/workflow-result";

export const NOW = new Date("2026-11-14T10:30:00.000Z");
export const meta = { now: NOW };

export function step(id: string, name: string, status: StepStatus, extra: Partial<StepResult> = {}): StepResult {
  return {
    stepId: id,
    name,
    status,
    skippedReason: status === "skipped" ? "Arrêté après un échec ou une erreur." : null,
    response:
      status === "skipped" || status === "error"
        ? null
        : { status: 200, durationMs: 30, sizeBytes: 10, finalUrl: null, truncated: false, preview: null },
    assertions: [],
    extracted: {},
    extractionErrors: [],
    error: status === "error" ? { code: "TIMEOUT", message: "trop long" } : null,
    ...extra,
  };
}

/** Un parcours connexion → création (en échec) → suppression (ignorée), avec des secrets partout. */
export function workflowResult(): WorkflowRunResult {
  return {
    workflow: "Boutique",
    status: "failed",
    stoppedAtStepId: "create",
    aborted: false,
    durationMs: 120,
    summary: { steps: 3, passed: 1, failed: 1, errors: 0, skipped: 1, assertionsPassed: 0, assertionsFailed: 1 },
    steps: [
      step("login", "Connexion", "passed", {
        response: { status: 200, durationMs: 42.5, sizeBytes: 50, finalUrl: "http://x/login?api_key=secretvalue&q=1", truncated: false, preview: '{"token":"zzz","ok":true}' },
        extracted: { token: "abc123" },
      }),
      step("create", "Création", "failed", {
        response: { status: 500, durationMs: 30, sizeBytes: 10, finalUrl: null, truncated: false, preview: null },
        assertions: [{ label: "Statut 201", type: "status", passed: false, message: "Statut attendu 201, reçu 500." }],
      }),
      step("delete", "Suppression", "skipped"),
    ],
    variables: { token: "abc123", base: "http://x" },
  };
}