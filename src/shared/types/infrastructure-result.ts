import type { InfraSample, PrometheusMetricKey } from "@/shared/schemas";

export interface PrometheusMetricStatus {
  key: PrometheusMetricKey;
  query: string;
  status: "ok" | "no-data" | "error";
  seriesCount: number;
  points: number;
  message: string | null;
}

export interface InfrastructureQueryResult {
  /** À brancher tel quel sur MeasuredRun.infraMetrics. */
  infraMetrics: { provenance: "observed"; samples: InfraSample[] };
  metrics: PrometheusMetricStatus[];
  /** Métriques absentes du résultat : non demandées, sans données ou en erreur. */
  missing: PrometheusMetricKey[];
  warnings: string[];
  range: { startedAtMs: number; durationSeconds: number; stepSeconds: number; samples: number };
}

export interface PrometheusCheckResult {
  ok: true;
  latencyMs: number;
}