import type { Policy } from "@/shared/schemas";

export type Severity = "info" | "warning" | "critical";
export type Confidence = "low" | "medium" | "high";
export type DataSource = "observed" | "user-provided" | "load-results" | "none";

export type FindingCode =
  | "cpu-limit"
  | "cpu-high-observation"
  | "memory-pressure"
  | "memory-high-observation"
  | "db-pool-limit"
  | "db-pool-high-observation"
  | "network-latency"
  | "io-or-dependency-wait"
  | "shared-dependency-scaling"
  | "scaling-comparison-inconclusive"
  | "slo-p95-breach"
  | "error-rate-anomaly"
  | "generator-saturated"
  | "dropped-iterations"
  | "no-infra-metrics"
  | "insufficient-load-range";

export interface Evidence {
  label: string;
  value: string;
}

export interface Finding {
  code: FindingCode;
  severity: Severity;
  confidence: Confidence;
  title: string;
  summary: string;
  /** Indicateurs combinés pour arriver à ce constat. */
  indicators: string[];
  evidence: Evidence[];
  /** D'où viennent les données utilisées. */
  dataSource: DataSource;
}

export type RecommendationKind = "scale-up" | "scale-out" | "tune" | "investigate" | "verify";

export interface Recommendation {
  kind: RecommendationKind;
  /** 1 = à traiter en premier. */
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  actions: string[];
  basedOn: FindingCode[];
}

export interface RunSummary {
  durationSeconds: number;
  totalRequests: number;
  totalFailed: number;
  errorRate: number | null;
  avgRps: number;
  peakRps: number;
  maxVus: number;
  /** p95 à faible charge (ms). */
  baselineP95Ms: number | null;
  peakP95Ms: number | null;
  droppedIterations: number;
}

/**
 * Ce que le test permet d'affirmer sur la capacité, en req/s, selon les objectifs :
 * - lower-bound : l'objectif a été respecté jusqu'au bout, la limite n'a pas été atteinte (capacité au moins égale)
 * - bracketed   : la limite a été atteinte, la capacité est comprise entre sustainedRps et breachRps
 * - upper-bound : l'objectif n'était déjà plus respecté au niveau testé (capacité inférieure ou égale)
 * - unknown     : pas assez de données
 */
export interface CapacityEvidence {
  kind: "lower-bound" | "bracketed" | "upper-bound" | "unknown";
  sustainedRps: number | null;
  breachRps: number | null;
  shape: "variable" | "constant";
  loadRange: { minRps: number; maxRps: number };
  basis: string;
}

export interface DataQuality {
  infraMetrics: "none" | "observed" | "user-provided";
  missingMetrics: string[];
  /** Faux quand le générateur était saturé. */
  reliable: boolean;
  warnings: string[];
}

export interface AnalyzeResult {
  /** Les recommandations sont consultatives : rien n'est appliqué automatiquement. */
  advisoryOnly: true;
  summary: RunSummary;
  capacity: CapacityEvidence;
  findings: Finding[];
  recommendations: Recommendation[];
  dataQuality: DataQuality;
  policy: Policy;
}