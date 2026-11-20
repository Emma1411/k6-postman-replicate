import { apiFetch } from "@/client/api/client";
import type { StoredLoadResult } from "@/client/storage/db";
import {
  buildPromQlPresets,
  type LabelMatcher,
  type PromQlPresetInput,
} from "@/shared/advisor/promql-presets";
import type {
  PrometheusAuth,
  PrometheusConnectionInput,
  PrometheusMetricKey,
  PrometheusQueryInput,
} from "@/shared/schemas";
import type {
  InfrastructureQueryResult,
  PrometheusCheckResult,
} from "@/shared/types/infrastructure-result";
import type { InfraDraft } from "./infra";
import { resultStartedAtMs } from "./run-info";

export type ComputeChoice = "none" | "node_exporter" | "cadvisor";
export type DatabaseChoice = "none" | "postgres_exporter" | "mysql_exporter";

export interface PromDraft {
  baseUrl: string;
  authType: "none" | "basic" | "bearer";
  /** Les identifiants ne sont jamais enregistrés dans le navigateur. */
  username: string;
  password: string;
  token: string;
  compute: ComputeChoice;
  database: DatabaseChoice;
  /** Un filtre facultatif sur la source de calcul : label = « valeur » (par exemple job = « node »). */

  matcherLabel: string;
  matcherValue: string;
  instanceLabel: string;
  rangeWindow: string;
  /** Requêtes PromQL saisies à la main : elles remplacent celles des préréglages. */
  custom: Partial<Record<PrometheusMetricKey, string>>;
  stepSeconds: number;
  clockOffsetSeconds: number;
}

export const DEFAULT_PROM: PromDraft = {
  baseUrl: "",
  authType: "none",
  username: "",
  password: "",
  token: "",
  compute: "node_exporter",
  database: "none",
  matcherLabel: "",
  matcherValue: "",
  instanceLabel: "",
  rangeWindow: "1m",
  custom: {},
  stepSeconds: 15,
  clockOffsetSeconds: 0,
};

/** En dessous de l'intervalle de scrape (15 s par défaut), Prometheus répète la dernière valeur. */
export const SCRAPE_STEP_SECONDS = 15;
/** Sous cette durée, la fenêtre de calcul des taux déborde du test et dilue les mesures. */
export const MIN_RELIABLE_RUN_SECONDS = 60;

export function queryWarnings(d: PromDraft, durationSeconds: number): string[] {
  const out: string[] = [];
  if (d.stepSeconds < SCRAPE_STEP_SECONDS) {
    out.push(
      `Pas de ${d.stepSeconds} s : si Prometheus collecte toutes les ${SCRAPE_STEP_SECONDS} s, les points sont dupliqués. Utilise ${SCRAPE_STEP_SECONDS} s ou plus.`,
    );
  }
  if (durationSeconds < MIN_RELIABLE_RUN_SECONDS) {
    out.push(
      `Test de ${Math.round(durationSeconds)} s : trop court pour des mesures d'infrastructure fiables (fenêtre de calcul ${d.rangeWindow}). Relance un test d'au moins ${MIN_RELIABLE_RUN_SECONDS} s.`,
    );
  }
  return out;
}

/** Ce qui peut être conservé dans le navigateur : tout sauf les identifiants. */
export type PersistedProm = Omit<PromDraft, "username" | "password" | "token">;

export function persistableProm(d: PromDraft): PersistedProm {
  const { username: _u, password: _p, token: _t, ...rest } = d;
  void _u;
  void _p;
  void _t;
  return rest;
}

export function isPersistedProm(value: unknown): value is PersistedProm {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.baseUrl === "string" &&
    ["none", "basic", "bearer"].includes(d.authType as string) &&
    ["none", "node_exporter", "cadvisor"].includes(d.compute as string) &&
    ["none", "postgres_exporter", "mysql_exporter"].includes(
      d.database as string,
    ) &&
    typeof d.matcherLabel === "string" &&
    typeof d.matcherValue === "string" &&
    typeof d.instanceLabel === "string" &&
    typeof d.rangeWindow === "string" &&
    typeof d.custom === "object" &&
    d.custom !== null &&
    typeof d.stepSeconds === "number" &&
    typeof d.clockOffsetSeconds === "number"
  );
}

export function validateConnection(d: PromDraft): string[] {
  const problems: string[] = [];
  if (!/^https?:\/\/\S+$/i.test(d.baseUrl.trim()))
    problems.push(
      "L'adresse de Prometheus doit commencer par http:// ou https://.",
    );
  if (d.authType === "basic") {
    if (d.username.trim() === "") problems.push("Saisis l'identifiant.");
    if (d.username.includes(":"))
      problems.push("L'identifiant ne peut pas contenir « : ».");
  }
  if (d.authType === "bearer" && d.token.trim() === "")
    problems.push("Saisis le jeton.");
  return problems;
}

export function buildConnection(d: PromDraft): PrometheusConnectionInput {
  const auth: PrometheusAuth =
    d.authType === "basic"
      ? { type: "basic", username: d.username.trim(), password: d.password }
      : d.authType === "bearer"
        ? { type: "bearer", token: d.token.trim() }
        : { type: "none" };
  return { baseUrl: d.baseUrl.trim(), auth };
}

export type QueriesOutcome =
  | { ok: true; queries: Partial<Record<PrometheusMetricKey, string>> }
  | { ok: false; error: string };

/** Les requêtes PromQL à envoyer : les préréglages, puis les requêtes saisies à la main par-dessus. */
export function buildQueries(d: PromDraft, infra: InfraDraft): QueriesOutcome {
  const matchers: LabelMatcher[] =
    d.matcherLabel.trim() !== "" && d.matcherValue !== ""
      ? [{ label: d.matcherLabel.trim(), op: "=", value: d.matcherValue }]
      : [];

  const input: PromQlPresetInput = {
    rangeWindow: d.rangeWindow.trim() || "1m",
    ...(d.compute !== "none"
      ? {
          compute: {
            source: d.compute,
            matchers,
            ...(d.instanceLabel.trim()
              ? { instanceLabel: d.instanceLabel.trim() }
              : {}),
            vcpuPerInstance: infra.vcpuPerInstance,
            ramGbPerInstance: infra.ramGbPerInstance,
          },
        }
      : {}),
    // Le filtre ne vise que la source de calcul : l'exporter de la base a son propre job.
    ...(d.database !== "none" ? { database: { source: d.database } } : {}),
  };

  let queries: Partial<Record<PrometheusMetricKey, string>>;
  try {
    queries = { ...buildPromQlPresets(input) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Les requêtes n'ont pas pu être construites.",
    };
  }
  for (const [key, value] of Object.entries(d.custom) as Array<
    [PrometheusMetricKey, string | undefined]
  >) {
    if (value && value.trim() !== "") queries[key] = value.trim();
  }
  if (Object.keys(queries).length === 0) {
    return {
      ok: false,
      error:
        "Choisis une source de mesures, ou saisis au moins une requête PromQL.",
    };
  }
  return { ok: true, queries };
}

export function buildQueryInput(
  d: PromDraft,
  infra: InfraDraft,
  stored: Pick<StoredLoadResult, "startedAt" | "savedAt" | "result">,
): { ok: true; input: PrometheusQueryInput } | { ok: false; error: string } {
  const queries = buildQueries(d, infra);
  if (!queries.ok) return queries;
  return {
    ok: true,
    input: {
      ...buildConnection(d),
      startedAtMs: resultStartedAtMs(stored),
      durationSeconds: Math.max(1, Math.ceil(stored.result.durationSeconds)),
      stepSeconds: d.stepSeconds,
      clockOffsetSeconds: d.clockOffsetSeconds,
      queries: queries.queries,
    },
  };
}

export const checkPrometheus = (
  connection: PrometheusConnectionInput,
  signal?: AbortSignal,
) =>
  apiFetch<PrometheusCheckResult>("/api/infrastructure/check", {
    body: connection,
    signal,
  });

export const queryPrometheus = (
  input: PrometheusQueryInput,
  signal?: AbortSignal,
) =>
  apiFetch<InfrastructureQueryResult>("/api/infrastructure/query", {
    body: input,
    signal,
  });
