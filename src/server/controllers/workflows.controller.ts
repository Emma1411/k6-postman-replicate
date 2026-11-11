import "server-only";
import { limits } from "@/server/config";
import { assertWorkflowWithinLimits } from "@/server/config/enforce-limits";
import { runWorkflow } from "@/server/engine/vu/run-workflow";
import { createHttpTransport } from "@/server/services/workflow/http-transport";
import type { RunWorkflowInput } from "@/shared/schemas";

export async function runWorkflowController(input: RunWorkflowInput, signal?: AbortSignal): Promise<Response> {
  assertWorkflowWithinLimits(input.workflow, limits);

  const result = await runWorkflow(input.workflow, {
    transport: createHttpTransport({ limits }),
    variables: input.variables,
    includePreview: true,
    deadlineAt: Date.now() + limits.workflow.maxDurationSeconds * 1000,
    signal,
  });
  return Response.json(result);
}