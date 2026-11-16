import "server-only";
import type { Limits } from "@/server/config/limits";
import type { StepResponse } from "@/server/engine/types";
import { evaluateAssertion } from "@/server/engine/vu/assertions";
import { ResponseView } from "@/server/engine/vu/response-view";
import type { HttpResponse, SendRequestInput } from "@/shared/schemas";
import type { SendRequestResult } from "@/shared/types/send-result";
import { executeHttpRequest } from "./index";

/** Adapte une réponse du client HTTP à ce qu'attend l'évaluateur d'assertions du moteur. */
export function toStepResponse(res: HttpResponse): StepResponse {
  return {
    status: res.status,
    headers: res.headers,
    bodyText: res.body.encoding === "utf8" ? res.body.content : null,
    bodyBytes: res.sizeBytes,
    durationMs: res.timings.totalMs,
    finalUrl: res.finalUrl,
    truncated: res.body.truncated,
  };
}

interface Deps {
  limits: Limits;
  /** Injectable pour les tests (aucun accès réseau). */
  execute?: typeof executeHttpRequest;
}

export async function executeWithAssertions(input: SendRequestInput, deps: Deps): Promise<SendRequestResult> {
  const execute = deps.execute ?? executeHttpRequest;
  // Une seule requête part vers la cible, quelles que soient les assertions.
  const response = await execute({ request: input.request, variables: input.variables }, { limits: deps.limits });
  if (input.assertions.length === 0) return { ...response, assertions: [] };

  const view = new ResponseView(toStepResponse(response));
  const assertions = input.assertions.map((assertion) => evaluateAssertion(assertion, view, input.variables));
  return { ...response, assertions };
}