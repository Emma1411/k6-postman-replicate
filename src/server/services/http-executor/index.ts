import "server-only";
import { performance } from "node:perf_hooks";
import type { ExecuteRequestInput, HttpResponse } from "@/shared/schemas";
import type { Limits } from "@/server/config/limits";
import { AppError } from "@/server/utils/errors";
import { validateTarget, type Resolver } from "@/server/middlewares/ssrf-guard";
import { interpolateRequest } from "./interpolate";
import { buildRequest } from "./build-request";
import { sendOnce } from "./send";

export interface ExecuteDeps {
  limits: Limits;
  resolver?: Resolver;
  /** Injectable pour les tests : par défaut, la garde SSRF. */
  validate?: typeof validateTarget;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Retirés quand une redirection change d'origine (schéma, hôte ou port).
const DROPPED_ON_CROSS_ORIGIN = ["authorization", "cookie", "proxy-authorization", "host"];
const DROPPED_WHEN_BODY_REMOVED = ["content-type", "content-length", "content-encoding"];

function redirectedMethod(status: number, method: string): string {
  if (status === 303) return method === "HEAD" ? "HEAD" : "GET";
  if ((status === 301 || status === 302) && method === "POST") return "GET";
  return method;
}

export function decodeBody(body: Buffer, truncated: boolean): HttpResponse["body"] {
  if (body.length === 0) return { encoding: "utf8", content: "", truncated };
  if (!body.includes(0)) {
    try {
      // stream: true évite de rejeter un caractère multi-octets coupé par la troncature.
      const content = new TextDecoder("utf-8", { fatal: true }).decode(body, { stream: truncated });
      return { encoding: "utf8", content, truncated };
    } catch {
      /* contenu non UTF-8 : renvoyé en base64 */
    }
  }
  return { encoding: "base64", content: body.toString("base64"), truncated };
}

/**
 * Exécute une requête HTTP pour l'API Client.
 * Les timings détaillés sont ceux de la dernière étape ; totalMs couvre toute la chaîne
 * (redirections comprises). sizeBytes est la taille du body décodé conservé.
 */
export async function executeHttpRequest(input: ExecuteRequestInput, deps: ExecuteDeps): Promise<HttpResponse> {
  const { limits } = deps;
  const validate = deps.validate ?? validateTarget;

  const { request, unresolved } = interpolateRequest(input.request, input.variables);
  if (unresolved.length > 0) {
    throw new AppError("VALIDATION_ERROR", `Variables non définies : ${unresolved.join(", ")}.`, {
      variables: unresolved,
    });
  }

  const built = await buildRequest(request, limits.http);
  const timeoutMs = Math.min(request.timeoutMs ?? limits.http.maxTimeoutMs, limits.http.maxTimeoutMs);
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;

  let current = {
    method: built.method as string,
    url: built.url,
    headers: { ...built.headers },
    body: built.body,
  };
  const redirects: HttpResponse["redirects"] = [];

  for (let hop = 0; ; hop++) {
    let target;
    try {
      target = await validate(current.url, limits, deps.resolver);
    } catch (err) {
      if (hop > 0 && err instanceof AppError && err.code === "VALIDATION_ERROR") {
        throw new AppError("UPSTREAM_ERROR", `Redirection invalide : ${err.message}`);
      }
      throw err;
    }

    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) throw new AppError("TIMEOUT", `La requête a dépassé le délai de ${timeoutMs} ms.`);

    const result = await sendOnce({
      method: current.method,
      target,
      headers: current.headers,
      body: current.body,
      timeoutMs,
      remainingMs,
      maxResponseBytes: limits.http.maxResponseBytes,
    });

    if (request.followRedirects && REDIRECT_STATUSES.has(result.status) && result.location) {
      if (hop >= limits.http.maxRedirects) {
        throw new AppError("UPSTREAM_ERROR", `Trop de redirections (maximum ${limits.http.maxRedirects}).`);
      }

      let next: URL;
      try {
        next = new URL(result.location, current.url);
      } catch {
        throw new AppError("UPSTREAM_ERROR", "Le header Location de la redirection est invalide.");
      }

      redirects.push({ url: current.url, status: result.status });

      const headers = { ...current.headers };
      if (next.origin !== target.url.origin) {
        for (const name of DROPPED_ON_CROSS_ORIGIN) delete headers[name];
      }
      const method = redirectedMethod(result.status, current.method);
      let body = current.body;
      if (method !== current.method) {
        body = null;
        for (const name of DROPPED_WHEN_BODY_REMOVED) delete headers[name];
      }
      current = { method, url: next.href, headers, body };
      continue;
    }

    return {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: decodeBody(result.body, result.truncated),
      sizeBytes: result.body.length,
      timings: { ...result.timings, totalMs: Math.round((performance.now() - startedAt) * 100) / 100 },
      redirects,
      finalUrl: current.url,
    };
  }
}