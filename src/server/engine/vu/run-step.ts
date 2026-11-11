import "server-only";
import type { Variables, WorkflowStep } from "@/shared/schemas";
import type { StepResult } from "@/shared/types/workflow-result";
import type { StepResponse, StepTransport } from "@/server/engine/types";
import { AppError } from "@/server/utils/errors";
import { evaluateAssertion } from "./assertions";
import { dynamicVariables } from "./dynamic-variables";
import { applyExtractors } from "./extractors";
import { ResponseView } from "./response-view";

export interface RunStepContext {
  transport: StepTransport;
  variables: Variables;
  vu: number;
  iteration: number;
  remainingMs: number | null;
  includePreview: boolean;
}

const PREVIEW_CHARS = 1024;

function toError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  console.error("[engine] erreur inattendue", err);
  return { code: "INTERNAL_ERROR", message: "Erreur inattendue pendant l'exécution de l'étape." };
}

export async function runStep(step: WorkflowStep, ctx: RunStepContext): Promise<StepResult> {
  const variables: Variables = { ...ctx.variables, ...dynamicVariables(ctx.vu, ctx.iteration) };

  let response: StepResponse;
  try {
    response = await ctx.transport(step.request, variables, { timeoutMs: ctx.remainingMs });
  } catch (err) {
    return {
      stepId: step.id,
      name: step.name,
      status: "error",
      skippedReason: null,
      response: null,
      assertions: [],
      extracted: {},
      extractionErrors: [],
      error: toError(err),
    };
  }

  const view = new ResponseView(response);
  const assertions = step.assertions.map((assertion) => evaluateAssertion(assertion, view, variables));
  const extraction = applyExtractors(step.extract, view);
  const failed = extraction.errors.length > 0 || assertions.some((a) => !a.passed);

  return {
    stepId: step.id,
    name: step.name,
    status: failed ? "failed" : "passed",
    skippedReason: null,
    response: {
      status: response.status,
      durationMs: response.durationMs,
      sizeBytes: response.bodyBytes,
      finalUrl: response.finalUrl,
      truncated: response.truncated,
      preview: ctx.includePreview && response.bodyText !== null ? response.bodyText.slice(0, PREVIEW_CHARS) : null,
    },
    assertions,
    extracted: extraction.values,
    extractionErrors: extraction.errors,
    error: null,
  };
}