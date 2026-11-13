import "server-only";
import { performance } from "node:perf_hooks";
import type { Limits } from "@/server/config/limits";
import { validateTarget, type Resolver } from "@/server/middlewares/ssrf-guard";
import { sendOnce } from "@/server/services/http-executor/send";
import { AppError } from "@/server/utils/errors";
import type { MatrixSeries } from "@/shared/advisor/prometheus-normalize";
import type { PrometheusAuth } from "@/shared/schemas";

export interface PrometheusConnection {
  baseUrl: string;
  auth?: PrometheusAuth;
}

export interface PrometheusDeps {
  limits: Limits;
  resolver?: Resolver;
  /** Injectables pour les tests. */
  validate?: typeof validateTarget;
  send?: typeof sendOnce;
}

/**
 * Un hôte de la liste de confiance de l'opérateur peut se trouver sur un réseau privé.
 * Entrée « hôte » : tous les ports ; entrée « hôte:port » : ce port seulement (port par défaut du protocole si absent de l'URL).
 */
export function isAllowlisted(url: URL, allowed: string[]): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const display = host.includes(":") ? `[${host}]` : host;
  return allowed.some((entry) => entry === display || entry === `${display}:${port}`);
}

async function prometheusGet(
  path: string,
  params: Record<string, string>,
  conn: PrometheusConnection,
  deps: PrometheusDeps,
): Promise<unknown> {
  const { limits } = deps;

  if (!/^https?:\/\//i.test(conn.baseUrl)) {
    throw new AppError("VALIDATION_ERROR", "L'adresse de Prometheus doit commencer par http:// ou https://.");
  }
  const base = conn.baseUrl.replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${base}${path}?${new URLSearchParams(params).toString()}`);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Adresse de Prometheus invalide.");
  }

  // La garde SSRF s'applique toujours ; seuls les hôtes explicitement autorisés par l'opérateur peuvent être privés.
  const allowlisted = isAllowlisted(url, limits.prometheus.allowedHosts);
  const validate = deps.validate ?? validateTarget;
  const target = await validate(url.href, allowlisted ? { network: { allowPrivateNetworks: true } } : limits, deps.resolver);

  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "ApiEngineeringPlatform/1.0",
    "accept-encoding": "identity",
  };
  if (conn.auth?.type === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${conn.auth.username}:${conn.auth.password}`, "utf8").toString("base64")}`;
  } else if (conn.auth?.type === "bearer") {
    headers.authorization = `Bearer ${conn.auth.token}`;
  }

  const send = deps.send ?? sendOnce;
  const timeoutMs = limits.prometheus.timeoutMs;
  const result = await send({
    method: "GET",
    target,
    headers,
    body: null,
    timeoutMs,
    remainingMs: timeoutMs,
    maxResponseBytes: limits.http.maxResponseBytes,
  });

  if (result.truncated) {
    throw new AppError("UPSTREAM_ERROR", "Réponse de Prometheus trop volumineuse : augmente le pas ou réduis la durée.");
  }
  if (result.status >= 300 && result.status < 400) {
    throw new AppError("UPSTREAM_ERROR", "Prometheus a répondu par une redirection, qui n'est pas suivie : utilise l'adresse finale.");
  }
  if (result.status === 401 || result.status === 403) {
    throw new AppError("UPSTREAM_ERROR", "Authentification refusée par Prometheus : vérifie les identifiants.");
  }

  let body: { status?: string; error?: string; data?: unknown } | undefined;
  try {
    const parsed: unknown = JSON.parse(result.body.toString("utf8"));
    body = typeof parsed === "object" && parsed !== null ? (parsed as typeof body) : undefined;
  } catch {
    body = undefined;
  }

  if (result.status === 400 || result.status === 422) {
    throw new AppError("VALIDATION_ERROR", `Prometheus refuse la requête : ${body?.error ?? "requête invalide"}.`);
  }
  if (result.status < 200 || result.status >= 300 || body?.status !== "success") {
    throw new AppError(
      "UPSTREAM_ERROR",
      `Prometheus a répondu avec une erreur (${result.status})${body?.error ? ` : ${body.error}` : ""}.`,
    );
  }
  return body.data;
}

export async function queryRange(
  conn: PrometheusConnection,
  query: string,
  startSeconds: number,
  endSeconds: number,
  stepSeconds: number,
  deps: PrometheusDeps,
): Promise<MatrixSeries[]> {
  const data = (await prometheusGet(
    "/api/v1/query_range",
    { query, start: String(startSeconds), end: String(endSeconds), step: String(stepSeconds) },
    conn,
    deps,
  )) as { resultType?: string; result?: MatrixSeries[] } | undefined;

  if (data?.resultType !== "matrix" || !Array.isArray(data.result)) {
    throw new AppError("UPSTREAM_ERROR", "Réponse de Prometheus inattendue (une matrice était attendue).");
  }
  return data.result;
}

/** Vérifie l'adresse, l'accès réseau et l'authentification avec une requête triviale. */
export async function checkConnection(
  conn: PrometheusConnection,
  deps: PrometheusDeps,
): Promise<{ ok: true; latencyMs: number }> {
  const started = performance.now();
  await prometheusGet("/api/v1/query", { query: "vector(1)" }, conn, deps);
  return { ok: true, latencyMs: Math.round((performance.now() - started) * 10) / 10 };
}