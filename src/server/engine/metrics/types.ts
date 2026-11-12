import type { LoadMetricName } from "@/shared/schemas";
import type { HistogramSnapshot } from "./histogram";

export type SimpleAggregation = "avg" | "min" | "max" | "med" | "count" | "rate" | "value";
export type Aggregation = { type: SimpleAggregation } | { type: "p"; percentile: number };

/** Ce dont les thresholds ont besoin pour lire une métrique. */
export interface MetricValueReader {
  /** Renvoie null si la métrique n'a pas de données ou si l'agrégation ne s'y applique pas. */
  getValue(metric: LoadMetricName, aggregation: Aggregation): number | null;
}

/** Une requête terminée, vue par le collecteur. */
export interface RequestSample {
  /** Durée en ms ; null quand aucune réponse n'a été reçue (connexion refusée, etc.). */
  durationMs: number | null;
  /** Statut ≥ 400, erreur réseau ou délai dépassé. */
  failed: boolean;
  /** Code HTTP, null si aucune réponse. */
  status: number | null;
  bytesSent: number;
  bytesReceived: number;
}

/** Ce qu'un worker envoie au thread principal à chaque fenêtre. */
export interface WindowDelta {
  requests: number;
  failed: number;
  checksPassed: number;
  checksFailed: number;
  iterations: number;
  dropped: number;
  dataSent: number;
  dataReceived: number;
  /** VUs actifs dans ce worker à l'instant du flush (jauge). */
  vus: number;
  status: Record<string, number>;
  duration: HistogramSnapshot;
  iterationDuration: HistogramSnapshot;
}