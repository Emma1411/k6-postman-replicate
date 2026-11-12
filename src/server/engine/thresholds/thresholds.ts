import "server-only";
import type { LoadMetricName, Threshold } from "@/shared/schemas";
import type { ThresholdResult } from "@/shared/types/load-result";
import { AppError } from "@/server/utils/errors";
import { round4 } from "@/server/engine/metrics/round";
import type { Aggregation, MetricValueReader, SimpleAggregation } from "@/server/engine/metrics/types";

export type Operator = "<" | "<=" | ">" | ">=" | "==" | "!=";

export interface ParsedThreshold {
  metric: LoadMetricName;
  expression: string;
  aggregation: Aggregation;
  operator: Operator;
  target: number;
  abortOnFail: boolean;
  delayAbortEvalSeconds: number;
}

type Kind = "trend" | "rate" | "counter" | "gauge";

const KIND: Record<LoadMetricName, Kind> = {
  http_req_duration: "trend",
  iteration_duration: "trend",
  http_req_failed: "rate",
  checks: "rate",
  http_reqs: "counter",
  dropped_iterations: "counter",
  iterations: "counter",
  data_sent: "counter",
  data_received: "counter",
  vus: "gauge",
};

/** Agrégations applicables à chaque type de métrique ("p" = percentile p(N)). */
const ALLOWED: Record<Kind, readonly string[]> = {
  trend: ["avg", "min", "max", "med", "count", "p"],
  rate: ["rate"],
  counter: ["count", "rate"],
  gauge: ["value", "min", "max"],
};

const EXPRESSION = /^(avg|min|max|med|count|rate|value|p\((\d{1,2}(?:\.\d+)?)\))\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)$/;

type ParseResult = { ok: true; value: ParsedThreshold } | { ok: false; error: string };

function parseOne(threshold: Threshold): ParseResult {
  const match = EXPRESSION.exec(threshold.expression.trim());
  if (!match) return { ok: false, error: `Expression de threshold invalide : "${threshold.expression}".` };

  const aggregation: Aggregation =
    match[2] !== undefined
      ? { type: "p", percentile: Number(match[2]) }
      : { type: match[1] as SimpleAggregation };

  const kind = KIND[threshold.metric];
  if (!ALLOWED[kind].includes(aggregation.type)) {
    const allowed = ALLOWED[kind].map((a) => (a === "p" ? "p(N)" : a)).join(", ");
    return {
      ok: false,
      error: `"${match[1]}" ne s'applique pas à ${threshold.metric} (agrégations possibles : ${allowed}).`,
    };
  }

  return {
    ok: true,
    value: {
      metric: threshold.metric,
      expression: threshold.expression,
      aggregation,
      operator: match[3] as Operator,
      target: Number(match[4]),
      abortOnFail: threshold.abortOnFail,
      delayAbortEvalSeconds: threshold.delayAbortEvalSeconds,
    },
  };
}

/** Analyse et vérifie tous les thresholds avant le lancement ; signale toutes les erreurs en une fois. */
export function parseThresholds(thresholds: Threshold[]): ParsedThreshold[] {
  const parsed: ParsedThreshold[] = [];
  const issues: Array<{ index: number; metric: string; expression: string; message: string }> = [];

  thresholds.forEach((threshold, index) => {
    const result = parseOne(threshold);
    if (result.ok) parsed.push(result.value);
    else issues.push({ index, metric: threshold.metric, expression: threshold.expression, message: result.error });
  });

  if (issues.length > 0) throw new AppError("VALIDATION_ERROR", "Thresholds invalides.", { issues });
  return parsed;
}

function compare(operator: Operator, value: number, target: number): boolean {
  switch (operator) {
    case "<":
      return value < target;
    case "<=":
      return value <= target;
    case ">":
      return value > target;
    case ">=":
      return value >= target;
    case "==":
      return Math.abs(value - target) < 1e-9;
    case "!=":
      return Math.abs(value - target) >= 1e-9;
  }
}

/**
 * Évalue les thresholds sur les valeurs cumulées.
 * Sans donnée : en cours de test le threshold n'est pas considéré en échec ;
 * à la fin (`final`), il échoue, car un test qui ne mesure rien ne prouve rien.
 */
export function evaluateThresholds(
  thresholds: ParsedThreshold[],
  reader: MetricValueReader,
  final: boolean,
): ThresholdResult[] {
  return thresholds.map((t) => {
    const value = reader.getValue(t.metric, t.aggregation);
    const noData = value === null;
    return {
      metric: t.metric,
      expression: t.expression,
      value: value === null ? null : round4(value),
      passed: value === null ? !final : compare(t.operator, value, t.target),
      noData,
      abortOnFail: t.abortOnFail,
    };
  });
}

/** Premier threshold en échec qui demande l'arrêt du test, une fois son délai d'attente écoulé. */
export function shouldAbort(
  results: ThresholdResult[],
  thresholds: ParsedThreshold[],
  elapsedSeconds: number,
): ThresholdResult | null {
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const threshold = thresholds[i];
    if (!result.passed && !result.noData && threshold.abortOnFail && elapsedSeconds >= threshold.delayAbortEvalSeconds) {
      return result;
    }
  }
  return null;
}