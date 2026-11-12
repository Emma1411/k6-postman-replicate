/** Statistiques d'une métrique de type Trend, en millisecondes. */
export interface TrendStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  med: number;
  p90: number;
  p95: number;
  p99: number;
}

/** Un point du graphique temporel : une fenêtre d'une seconde. */
export interface WindowPoint {
  /** Secondes écoulées à la fin de la fenêtre. */
  t: number;
  vus: number;
  requests: number;
  rps: number;
  failed: number;
  errorRate: number | null;
  duration: TrendStats | null;
  iterations: number;
  dropped: number;
  checksPassed: number;
  checksFailed: number;
  dataSent: number;
  dataReceived: number;
}

/** Valeurs cumulées depuis le début du test. */
export interface MetricsSnapshot {
  elapsedSeconds: number;
  vus: { value: number; min: number; max: number };
  http_reqs: { count: number; rate: number };
  http_req_failed: { rate: number | null; fails: number; total: number };
  http_req_duration: TrendStats | null;
  iterations: { count: number; rate: number };
  iteration_duration: TrendStats | null;
  dropped_iterations: { count: number; rate: number };
  checks: { rate: number | null; passes: number; fails: number };
  data_sent: { count: number; rate: number };
  data_received: { count: number; rate: number };
  /** Répartition des statuts HTTP ; "error" = aucune réponse (réseau, délai). */
  statusDistribution: Record<string, number>;
}

export interface ThresholdResult {
  metric: string;
  expression: string;
  value: number | null;
  passed: boolean;
  /** Aucune donnée pour cette métrique. */
  noData: boolean;
  abortOnFail: boolean;
}

export type RunState = "starting" | "running" | "stopping" | "finished";
export type RunStatus = "passed" | "failed" | "aborted" | "error";

/** État de santé du générateur de charge (pas de l'application testée). */
export interface GeneratorStatus {
  /** Retard maximal de la boucle d'événements des workers sur la fenêtre (percentile 99, ms). */
  loopDelayP99Ms: number;
  loopDelayMaxMs: number;
  /** Vrai quand le retard est assez élevé pour fausser les latences mesurées. */
  saturated: boolean;
}

export interface GeneratorSummary {
  saturated: boolean;
  saturatedWindows: number;
  maxLoopDelayMs: number;
  workers: number;
}

export interface LoadRunInfo {
  runId: string;
  name: string;
  executorType: string;
  workers: number;
  plannedDurationSeconds: number;
  /** Heure de départ (ms depuis l'epoch), null tant que le test n'a pas démarré. */
  startedAt: number | null;
  state: RunState;
}

export interface LoadRunResult {
  runId: string;
  name: string;
  status: RunStatus;
  abortReason: string | null;
  error: string | null;
  durationSeconds: number;
  snapshot: MetricsSnapshot;
  thresholds: ThresholdResult[];
  thresholdsPassed: boolean;
  generator: GeneratorSummary;
}

export type LoadEvent =
  | {
      type: "init";
      run: LoadRunInfo;
      points: WindowPoint[];
      snapshot: MetricsSnapshot | null;
      thresholds: ThresholdResult[];
      generator: GeneratorStatus;
      result: LoadRunResult | null;
    }
  | { type: "started"; run: LoadRunInfo }
  | {
      type: "window";
      point: WindowPoint;
      snapshot: MetricsSnapshot;
      thresholds: ThresholdResult[];
      generator: GeneratorStatus;
    }
  | { type: "stopping"; reason: string }
  | { type: "finished"; result: LoadRunResult };