import type { ArchitectureConfig, ExecutorConfig, Threshold } from "@/shared/schemas";
import type { Confidence } from "./advisor-result";

export type Verdict = "ok" | "marginal" | "insufficient" | "undetermined";
export type CheckStatus = "ok" | "marginal" | "fail" | "unknown";
export type LimitedBy = "cpu" | "observed-bottleneck" | "observed" | null;

export interface Check {
  status: CheckStatus;
  detail: string;
}

export interface Assumption {
  key: string;
  label: string;
  value: string;
  /** default = valeur par défaut ; user-provided = saisie ; calibrated = déduite des mesures. */
  source: "default" | "user-provided" | "calibrated";
  note: string;
}

export interface ScenarioResult {
  name: string;
  config: ArchitectureConfig;
  /** Vrai quand la configuration est celle du test de référence : la capacité vient alors de la mesure, pas du modèle. */
  isReference: boolean;
  totals: { vcpu: number; ramGb: number };
  capacity: {
    /** Estimation centrale (req/s). */
    estimateRps: number | null;
    /** Cas pessimiste et cas optimiste. */
    lowRps: number | null;
    highRps: number | null;
    limitedBy: LimitedBy;
    /** Débit cible maximal en conservant la marge demandée : au-delà, il faut ajouter de la capacité. */
    maxTargetRps: number | null;
  };
  atTarget: {
    cpuUtilizationPercent: number | null;
    p95Ms: number | null;
    p95PessimisticMs: number | null;
    memoryPercent: number | null;
    databaseConnections: number | null;
  };
  checks: { capacity: Check; latency: Check; memory: Check; database: Check };
  /**
   * ok : tous les contrôles passent, y compris dans le cas pessimiste.
   * marginal : passe avec l'estimation centrale mais pas dans le cas pessimiste.
   * insufficient : au moins un contrôle échoue.
   * undetermined : pas assez d'information pour estimer la capacité.
   */
  verdict: Verdict;
  confidence: Confidence;
  /** Contrôles qui n'ont pas pu être faits, faute de données. */
  unchecked: string[];
  notes: string[];
  vsBaseline: { capacityChangePercent: number | null; p95ChangeMs: number | null } | null;
}

export interface SizingResult {
  template: { vcpuPerInstance: number; ramGbPerInstance: number };
  /** Nombre minimal d'instances dont l'estimation centrale passe tous les contrôles. */
  minimumInstances: number | null;
  /** Nombre d'instances pour lequel même le cas pessimiste passe. */
  recommendedInstances: number | null;
  recommended: ScenarioResult | null;
  /** Débit maximal que la mise à l'échelle horizontale pourra jamais atteindre avec cette taille d'instance. */
  scaleOutLimitRps: number | null;
  /** Nombre maximal d'instances compatible avec la limite de connexions de la base. */
  databaseMaxInstances: number | null;
  explanation: string;
}

export interface VerificationPlan {
  executor: ExecutorConfig;
  thresholds: Threshold[];
  expectedPeakRps: number;
  durationSeconds: number;
  notes: string[];
  /** Renseigné côté serveur : le plan respecte-t-il les limites de ce serveur ? */
  withinServerLimits?: { ok: boolean; violations: string[] };
}

export interface CapacityResult {
  advisoryOnly: true;
  mode: "predictive" | "measured";
  target: {
    targetRps: number;
    requiredRps: number;
    requestsPerIteration: number;
    p95MaxMs: number | null;
    headroomPercent: number;
  };
  /** Résumé du modèle utilisé : ce qui a été calibré, ce qui est supposé. */
  modelSummary: string[];
  assumptions: Assumption[];
  baseline: ScenarioResult | null;
  scenarios: ScenarioResult[];
  best: { index: number; reason: string } | null;
  sizing: SizingResult;
  verification: VerificationPlan;
  warnings: string[];
}