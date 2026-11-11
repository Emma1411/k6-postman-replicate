export type StepStatus = "passed" | "failed" | "error" | "skipped";

export interface AssertionResult {
  label: string;
  type: string;
  passed: boolean;
  message: string | null;
}

export interface StepResult {
  stepId: string;
  name: string;
  /**
   * passed  : requête réussie, assertions et extractions OK
   * failed  : requête réussie mais une assertion ou une extraction a échoué
   * error   : la requête n'a pas pu être exécutée (réseau, délai, variable non définie…)
   * skipped : condition non remplie, ou workflow arrêté / interrompu
   */
  status: StepStatus;
  skippedReason: string | null;
  response: {
    status: number;
    durationMs: number;
    sizeBytes: number;
    finalUrl: string | null;
    truncated: boolean;
    preview: string | null;
  } | null;
  assertions: AssertionResult[];
  extracted: Record<string, string>;
  extractionErrors: string[];
  error: { code: string; message: string } | null;
}

export interface WorkflowSummary {
  steps: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  assertionsPassed: number;
  assertionsFailed: number;
}

export interface WorkflowRunResult {
  workflow: string;
  status: "passed" | "failed";
  stoppedAtStepId: string | null;
  /** true si le délai global ou l'annulation a interrompu l'exécution. */
  aborted: boolean;
  durationMs: number;
  summary: WorkflowSummary;
  steps: StepResult[];
  /** État final des variables (hors variables dynamiques). */
  variables: Record<string, string>;
}