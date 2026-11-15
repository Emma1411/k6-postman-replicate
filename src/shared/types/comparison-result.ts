import type { ExecutorConfig, LoadPoint, Objectives } from "@/shared/schemas";
import type { Confidence } from "./advisor-result";
import type { LoadRunResult } from "./load-result";
import type { StepStatus } from "./workflow-result";

/** Un test de charge tel que le client le conserve, avec de quoi le comparer à un autre. */
export interface LoadRunRecord {
  /** Nom lisible : « v1.4 », « staging 12 nov. »… */
  label: string;
  environment?: string;
  startedAt?: number;
  executor: ExecutorConfig;
  /** Empreinte du workflow (hachage calculé par le client) : vérifie que deux tests exécutent le même scénario. */
  workflowFingerprint?: string;
  result: LoadRunResult;
  /** Série temporelle du test (WindowPoint[] accepté tel quel) : nécessaire pour comparer la capacité. */
  points?: LoadPoint[];
}

export interface ComparisonThresholds {
  /** Hausse de latence minimale, en pourcentage de la référence… */
  latencyPercent: number;
  /** …et en millisecondes : les deux doivent être dépassés. */
  latencyMinMs: number;
  /** Écart de taux d'erreur, en points de pourcentage. */
  errorRatePoints: number;
  throughputPercent: number;
  /** Écart du taux d'assertions réussies, en points. */
  checksPoints: number;
  /** Écart du taux d'itérations abandonnées, en points. */
  droppedPoints: number;
  capacityPercent: number;
}

export interface ComparisonOptions extends ComparisonThresholds {
  /** Objectifs utilisés pour déterminer la capacité observée (p95 maximal, taux d'erreur acceptable). */
  objectives: Objectives;
}

export type ChangeVerdict = "regression" | "improvement" | "unchanged" | "unknown";

export interface MetricComparison {
  key: string;
  label: string;
  unit: "ms" | "req/s" | "%";
  better: "lower" | "higher";
  /** Médiane des tests de référence. */
  baseline: number | null;
  /** Étendue des tests de référence (min, max), quand il y en a plusieurs. */
  baselineRange: [number, number] | null;
  candidate: number | null;
  change: number | null;
  changePercent: number | null;
  verdict: ChangeVerdict;
  note: string | null;
}

export interface ThresholdChange {
  metric: string;
  expression: string;
  baseline: "passed" | "failed" | "mixed" | "absent";
  candidate: "passed" | "failed";
  kind: "newly-failing" | "newly-passing" | "unchanged";
}

export interface RunIdentity {
  label: string;
  environment: string | null;
}

export interface RunComparison {
  overall: "regression" | "improvement" | "no-change" | "inconclusive";
  summary: string;
  comparability: { level: "comparable" | "partial" | "not-comparable"; issues: string[] };
  confidence: Confidence;
  baselineCount: number;
  baselines: RunIdentity[];
  candidate: RunIdentity;
  metrics: MetricComparison[];
  thresholds: ThresholdChange[];
  regressions: string[];
  improvements: string[];
  notes: string[];
  options: ComparisonOptions;
}

// --- Tests fonctionnels ---------------------------------------------------------------------------------------------

export interface StepChange {
  stepId: string;
  name: string;
  kind: "newly-failing" | "fixed" | "newly-skipped" | "newly-run" | "assertions-changed";
  baselineStatus: StepStatus;
  candidateStatus: StepStatus;
  /** Détail lisible : assertions qui échouent maintenant ou qui sont corrigées, erreurs. */
  changes: string[];
}

export interface StepTiming {
  stepId: string;
  name: string;
  baselineMs: number;
  candidateMs: number;
  changePercent: number;
}

export interface WorkflowComparison {
  overall: "regression" | "improvement" | "no-change";
  summary: string;
  status: { baseline: "passed" | "failed"; candidate: "passed" | "failed" };
  steps: StepChange[];
  /** Étapes nettement plus lentes : une mesure unique, donc indicative (elle ne suffit pas à déclarer une régression). */
  slower: StepTiming[];
  added: string[];
  removed: string[];
  notes: string[];
}