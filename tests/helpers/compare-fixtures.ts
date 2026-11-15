import { ExecutorSchema, type LoadPoint } from "@/shared/schemas";
import type { LoadRunRecord } from "@/shared/types/comparison-result";
import type { LoadRunResult, ThresholdResult } from "@/shared/types/load-result";

export interface ResultSpec {
  avg?: number;
  med?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  /** Fraction (0,01 = 1 %). */
  errorRate?: number;
  rps?: number;
  /** Fraction. */
  checksRate?: number;
  iterations?: number;
  dropped?: number;
  durationSeconds?: number;
  saturated?: boolean;
  status?: LoadRunResult["status"];
  thresholds?: ThresholdResult[];
}

export function loadResult(spec: ResultSpec = {}): LoadRunResult {
  const duration = spec.durationSeconds ?? 60;
  const trend = {
    count: 30_000,
    avg: spec.avg ?? 100,
    min: 5,
    max: 900,
    med: spec.med ?? 90,
    p90: spec.p90 ?? 150,
    p95: spec.p95 ?? 200,
    p99: spec.p99 ?? 300,
  };
  const thresholds = spec.thresholds ?? [];

  return {
    runId: "run",
    name: "Scénario",
    status: spec.status ?? "passed",
    abortReason: null,
    error: null,
    durationSeconds: duration,
    snapshot: {
      elapsedSeconds: duration,
      vus: { value: 0, min: 0, max: 50 },
      http_reqs: { count: 30_000, rate: spec.rps ?? 500 },
      http_req_failed: { rate: spec.errorRate ?? 0.002, fails: 60, total: 30_000 },
      http_req_duration: trend,
      iterations: { count: spec.iterations ?? 5000, rate: 80 },
      iteration_duration: trend,
      dropped_iterations: { count: spec.dropped ?? 0, rate: 0 },
      checks: { rate: spec.checksRate ?? 1, passes: 10_000, fails: 0 },
      data_sent: { count: 1, rate: 1 },
      data_received: { count: 1, rate: 1 },
      statusDistribution: { "200": 30_000 },
    },
    thresholds,
    thresholdsPassed: thresholds.every((t) => t.passed),
    generator: {
      saturated: spec.saturated ?? false,
      saturatedWindows: spec.saturated ? 3 : 0,
      maxLoopDelayMs: 1,
      workers: 2,
    },
  };
}

export interface RecordSpec extends ResultSpec {
  label?: string;
  environment?: string;
  executor?: unknown;
  fingerprint?: string;
  points?: LoadPoint[];
}

export function record(spec: RecordSpec = {}): LoadRunRecord {
  const { label, environment, executor, fingerprint, points, ...result } = spec;
  return {
    label: label ?? "test",
    environment,
    executor: ExecutorSchema.parse(executor ?? { type: "constant-vus", vus: 50, durationSeconds: 60 }),
    workflowFingerprint: fingerprint,
    result: loadResult(result),
    points,
  };
}

export const threshold = (metric: string, expression: string, passed: boolean): ThresholdResult => ({
  metric,
  expression,
  value: 1,
  passed,
  noData: false,
  abortOnFail: false,
});