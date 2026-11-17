import { formatMs, formatPercent } from "@/client/lib/format";
import type { ThresholdResult } from "@/shared/types/load-result";

const OPERATORS: Record<string, string> = { "<=": "≤", ">=": "≥", "<": "<", ">": ">", "==": "=", "!=": "≠" };
const PARSED = /^(avg|min|max|med|count|rate|value|p\(\d{1,2}(?:\.\d+)?\))\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)$/;

/** Un seuil en français : « Latence p95 < 300 ms ». */
export function describeThreshold(t: Pick<ThresholdResult, "metric" | "expression">): string {
  const m = PARSED.exec(t.expression);
  if (!m) return `${t.metric} ${t.expression}`;
  const [, aggregation, operator, raw] = m;
  const limit = Number(raw);
  const symbol = OPERATORS[operator] ?? operator;

  if (t.metric === "http_req_duration") {
    const name = aggregation.startsWith("p(")
      ? `p${aggregation.slice(2, -1)}`
      : aggregation === "med"
        ? "médiane"
        : aggregation === "avg"
          ? "moyenne"
          : aggregation;
    return `Latence ${name} ${symbol} ${formatMs(limit)}`;
  }
  if (t.metric === "http_req_failed" && aggregation === "rate") return `Taux d'erreur ${symbol} ${formatPercent(limit)}`;
  if (t.metric === "checks" && aggregation === "rate") return `Vérifications réussies ${symbol} ${formatPercent(limit)}`;
  return `${t.metric} ${t.expression}`;
}

export function formatThresholdValue(t: Pick<ThresholdResult, "metric" | "expression" | "value">): string {
  if (t.value === null) return "—";
  if (t.metric === "http_req_duration") return formatMs(t.value);
  if (t.expression.startsWith("rate")) return formatPercent(t.value);
  return String(t.value);
}