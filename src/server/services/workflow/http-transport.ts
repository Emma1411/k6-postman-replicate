import "server-only";
import { executeHttpRequest, type ExecuteDeps } from "@/server/services/http-executor";
import type { StepTransport } from "@/server/engine/types";

/** Transport pour les tests fonctionnels : une requête complète par étape, via l'exécuteur HTTP. */
export function createHttpTransport(deps: ExecuteDeps): StepTransport {
  return async (request, variables, ctx) => {
    const maxMs = deps.limits.http.maxTimeoutMs;
    const timeoutMs = Math.min(request.timeoutMs ?? maxMs, ctx.timeoutMs ?? maxMs);

    const res = await executeHttpRequest({ request: { ...request, timeoutMs }, variables }, deps);
    return {
      status: res.status,
      headers: res.headers,
      bodyText: res.body.encoding === "utf8" ? res.body.content : null,
      bodyBytes: res.sizeBytes,
      durationMs: res.timings.totalMs,
      finalUrl: res.finalUrl,
      truncated: res.body.truncated,
    };
  };
}