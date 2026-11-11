import "server-only";
import type { z } from "zod";
import { limits } from "@/server/config";
import { getClientIp } from "@/server/utils/client-ip";
import { enforceRateLimit } from "./rate-limit";
import { parseInput, readJsonBody } from "./validate";
import { toErrorResponse } from "./error-handler";

export interface ApiContext {
  ip: string;
  request: Request;
}

export interface WithApiOptions<S extends z.ZodType> {
  schema: S;
  /** Ajoute le quota horaire de lancement de tests de charge. */
  rateLimit?: "general" | "loadRuns";
  maxBodyBytes?: number;
}

/** Taille max de l'enveloppe JSON : body cible + surcoût base64 (×4/3) + marge pour le reste. */
export function apiBodyLimitBytes(): number {
  return Math.ceil((limits.http.maxRequestBodyBytes * 4) / 3) + 256 * 1024;
}

/**
 * Ordre : rate limit général → lecture du body (taille max) → validation Zod →
 * quota des tests de charge (seules les requêtes valides le consomment) → handler.
 */
export function withApi<S extends z.ZodType>(
  options: WithApiOptions<S>,
  handler: (input: z.output<S>, ctx: ApiContext) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const ip = getClientIp(request.headers, limits.rateLimit.trustedProxyHops);
      enforceRateLimit("general", ip);

      const raw = await readJsonBody(request, options.maxBodyBytes ?? apiBodyLimitBytes());
      const input = parseInput(options.schema, raw);

      if (options.rateLimit === "loadRuns") enforceRateLimit("loadRuns", ip);

      return await handler(input, { ip, request });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}