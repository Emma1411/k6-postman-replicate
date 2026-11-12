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