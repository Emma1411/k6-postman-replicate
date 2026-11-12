import "server-only";
import { setMaxListeners } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import type { LookupFunction } from "node:net";
import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";
import { Agent, request as undiciRequest, type Dispatcher } from "undici";
import type { Limits } from "@/server/config/limits";
import type { MetricsRecorder } from "@/server/engine/metrics/recorder";
import type { StepResponse, StepTransport } from "@/server/engine/types";
import { assertUrlAllowed, createGuardedLookup } from "@/server/middlewares/ssrf-guard";
import { buildRequest, type BuiltRequest } from "@/server/services/http-executor/build-request";
import { decodeBody } from "@/server/services/http-executor";
import { interpolateRequest } from "@/server/services/http-executor/interpolate";
import { collect, createDecoder, mapNetworkError } from "@/server/services/http-executor/send";
import { AppError } from "@/server/utils/errors";

/**
 * Agent HTTP du moteur de charge : connexions persistantes (keep-alive), une connexion par requête
 * en cours, et garde SSRF appliquée à chaque connexion ouverte.
 */
export function createLoadDispatcher(limits: Pick<Limits, "network">): Dispatcher {
  return new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 600_000,
    connect: { timeout: 10_000, lookup: createGuardedLookup(limits) as LookupFunction },
  });
}

export interface LoadTransportDeps {
  limits: Limits;
  dispatcher: Dispatcher;
  recorder: Pick<MetricsRecorder, "recordRequest">;
  /** Arrêt du test : les requêtes en cours sont annulées, sans être comptées comme des échecs. */
  signal: AbortSignal;
}

interface TimeoutGuard {
  signal: AbortSignal;
  readonly timedOut: boolean;
  cleanup(): void;
}

function timeoutGuard(ms: number, parent: AbortSignal): TimeoutGuard {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onParentAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onParentAbort, { once: true });

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

function toHeaderPairs(headers: IncomingHttpHeaders): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) for (const v of value) pairs.push({ key, value: v });
    else if (value !== undefined) pairs.push({ key, value });
  }
  return pairs;
}

const headerBytes = (pairs: Array<{ key: string; value: string }>): number =>
  pairs.reduce((sum, h) => sum + h.key.length + h.value.length + 4, 15);

/** Approximation : ligne de requête + headers + body, sans l'overhead TCP/TLS. */
function requestBytes(built: BuiltRequest): number {
  let n = built.method.length + built.url.length + 12;
  for (const [key, value] of Object.entries(built.headers)) n += key.length + value.length + 4;
  return n + (built.body?.length ?? 0);
}

interface BodyResult {
  text: string | null;
  bytes: number;
  wireBytes: number;
  truncated: boolean;
}

async function readBody(res: Dispatcher.ResponseData, needBody: boolean, maxBytes: number): Promise<BodyResult> {
  if (!needBody) {
    // On vide le flux pour réutiliser la connexion, sans rien accumuler ni décoder.
    let bytes = 0;
    for await (const chunk of res.body) bytes += (chunk as Buffer).length;
    return { text: null, bytes, wireBytes: bytes, truncated: false };
  }

  const decoder = createDecoder(first(res.headers["content-encoding"]).toLowerCase().trim());
  let source: Readable = res.body;
  let wireFailed = false;
  if (decoder) {
    res.body.on("error", (err) => {
      wireFailed = true;
      decoder.destroy(err);
    });
    res.body.pipe(decoder);
    source = decoder;
  }

  try {
    const { body, truncated } = await collect(source, maxBytes);
    if (truncated) res.body.destroy();
    const decoded = decodeBody(body, truncated);
    const declared = Number(first(res.headers["content-length"]));
    return {
      text: decoded.encoding === "utf8" ? decoded.content : null,
      bytes: body.length,
      wireBytes: decoder && Number.isFinite(declared) && declared > 0 ? declared : body.length,
      truncated,
    };
  } catch (err) {
    if (decoder && !wireFailed) {
      throw new AppError("UPSTREAM_ERROR", "Réponse compressée invalide ou corrompue.");
    }
    throw err;
  }
}

function mapLoadError(err: unknown, guard: TimeoutGuard | null): AppError {
  if (err instanceof AppError) return err;
  if (guard?.timedOut) return new AppError("TIMEOUT", "Délai dépassé.");

  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  switch (code) {
    case "ESSRFBLOCKED":
      return new AppError(
        "SSRF_BLOCKED",
        "Destination non autorisée : le serveur refuse d'envoyer des requêtes vers des adresses privées ou internes.",
      );
    case "UND_ERR_CONNECT_TIMEOUT":
      return new AppError("UPSTREAM_ERROR", "Délai de connexion dépassé.", { code });
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return new AppError("TIMEOUT", "Délai dépassé.", { code });
    case "UND_ERR_SOCKET":
    case "UND_ERR_CLOSED":
      return new AppError("UPSTREAM_ERROR", "Connexion interrompue par le serveur cible.", { code });
  }
  return mapNetworkError(err);
}

/**
 * Transport du moteur de charge. Enregistre chaque requête dans les métriques :
 * durée (jusqu'à la fin de la lecture du body), statut, erreurs, octets.
 * Ne suit pas les redirections : une 3xx est une réponse comme une autre.
 */
export function createLoadTransport(deps: LoadTransportDeps): StepTransport {
  const { limits, dispatcher, recorder, signal } = deps;
  setMaxListeners(0, signal); // une écoute d'annulation par requête en cours

  return async (request, variables, ctx) => {
    let bytesSent = 0;
    let startedAt: number | null = null;
    let guard: TimeoutGuard | null = null;

    try {
      const { request: interpolated, unresolved } = interpolateRequest(request, variables);
      if (unresolved.length > 0) {
        throw new AppError("VALIDATION_ERROR", `Variables non définies : ${unresolved.join(", ")}.`);
      }
      const built = await buildRequest(interpolated, limits.http);
      assertUrlAllowed(built.url, limits);

      const maxMs = limits.http.maxTimeoutMs;
      const timeoutMs = Math.min(interpolated.timeoutMs ?? maxMs, ctx.timeoutMs ?? maxMs, maxMs);
      bytesSent = requestBytes(built);

      guard = timeoutGuard(timeoutMs, signal);
      startedAt = performance.now();
      const res = await undiciRequest(built.url, {
        method: built.method,
        headers: built.headers,
        body: built.body ?? undefined,
        dispatcher,
        signal: guard.signal,
      });
      const body = await readBody(res, ctx.needsBody, limits.http.maxResponseBytes);
      const durationMs = performance.now() - startedAt;

      const headers = toHeaderPairs(res.headers);
      recorder.recordRequest({
        durationMs,
        failed: res.statusCode >= 400,
        status: res.statusCode,
        bytesSent,
        bytesReceived: headerBytes(headers) + body.wireBytes,
      });

      const response: StepResponse = {
        status: res.statusCode,
        headers,
        bodyText: body.text,
        bodyBytes: body.bytes,
        durationMs,
        finalUrl: built.url,
        truncated: body.truncated,
      };
      return response;
    } catch (err) {
      const appError = mapLoadError(err, guard);

      // Arrêt demandé : la requête est abandonnée, ce n'est pas un échec de l'application testée.
      if (signal.aborted && !guard?.timedOut) {
        throw new AppError("UPSTREAM_ERROR", "Requête annulée.");
      }

      const measured = appError.code === "TIMEOUT" && startedAt !== null;
      recorder.recordRequest({
        durationMs: measured ? performance.now() - (startedAt as number) : null,
        failed: true,
        status: null,
        bytesSent,
        bytesReceived: 0,
      });
      throw appError;
    } finally {
      guard?.cleanup();
    }
  };
}