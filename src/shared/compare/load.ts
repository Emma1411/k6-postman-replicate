import { ObjectivesSchema } from "@/shared/schemas";
import type { ExecutorConfig, Objectives } from "@/shared/schemas";
import type { z } from "zod";
import type { CapacityEvidence, Confidence } from "@/shared/types/advisor-result";
import type {
  ChangeVerdict,
  ComparisonOptions,
  ComparisonThresholds,
  LoadRunRecord,
  MetricComparison,
  RunComparison,
  ThresholdChange,
} from "@/shared/types/comparison-result";
import type { LoadRunResult } from "@/shared/types/load-result";
import { detectShape, observedCapacity } from "../advisor/capacity-evidence";
import { rolling } from "../advisor/series";
import { median, round2 } from "../advisor/stats";
import { formatNumber, formatSigned } from "../format";

export class ComparisonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonInputError";
  }
}

export const DEFAULT_THRESHOLDS: ComparisonThresholds = {
  latencyPercent: 10,
  latencyMinMs: 20,
  errorRatePoints: 0.5,
  throughputPercent: 10,
  checksPoints: 1,
  droppedPoints: 1,
  capacityPercent: 10,
};

export interface ComparisonOptionsInput extends Partial<ComparisonThresholds> {
  objectives?: z.input<typeof ObjectivesSchema>;
}

export function resolveOptions(input: ComparisonOptionsInput = {}): ComparisonOptions {
  const { objectives, ...thresholds } = input;
  const defined = Object.fromEntries(Object.entries(thresholds).filter(([, v]) => v !== undefined)) as Partial<ComparisonThresholds>;
  return { ...DEFAULT_THRESHOLDS, ...defined, objectives: ObjectivesSchema.parse(objectives ?? {}) };
}

const nonNull = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

// --- Comparabilité --------------------------------------------------------------------------------------------------

/** Ce qui définit la charge appliquée (hors durée des executors à charge constante). */
export function loadSignature(e: ExecutorConfig): string {
  const stages = (s: Array<{ durationSeconds: number; target: number }>) =>
    s.map((x) => `${x.durationSeconds} s → ${x.target}`).join(", ");

  switch (e.type) {
    case "constant-vus":
      return `constant-vus : ${e.vus} VUs`;
    case "ramping-vus":
      return `ramping-vus : départ ${e.startVus}, ${stages(e.stages)}`;
    case "constant-arrival-rate":
      return `constant-arrival-rate : ${e.rate} par ${e.timeUnitSeconds} s`;
    case "ramping-arrival-rate":
      return `ramping-arrival-rate : départ ${e.startRate} par ${e.timeUnitSeconds} s, ${stages(e.stages)}`;
    case "per-vu-iterations":
      return `per-vu-iterations : ${e.vus} VUs × ${e.iterations} itérations`;
    case "shared-iterations":
      return `shared-iterations : ${e.iterations} itérations sur ${e.vus} VUs`;
  }
}

function assessComparability(
  baselines: LoadRunRecord[],
  candidate: LoadRunRecord,
): { level: RunComparison["comparability"]["level"]; issues: string[]; notes: string[] } {
  const blocking: string[] = [];
  const cautions: string[] = [];
  const notes: string[] = [];
  const candidateSignature = loadSignature(candidate.executor);

  for (const base of baselines) {
    const signature = loadSignature(base.executor);
    if (signature !== candidateSignature) {
      blocking.push(`Charge différente : « ${base.label} » = ${signature} ; « ${candidate.label} » = ${candidateSignature}.`);
    }
    if (
      base.workflowFingerprint !== undefined &&
      candidate.workflowFingerprint !== undefined &&
      base.workflowFingerprint !== candidate.workflowFingerprint
    ) {
      blocking.push(`Scénario différent : « ${base.label} » et « ${candidate.label} » n'exécutent pas le même workflow.`);
    }
  }

  const everyone = [...baselines, candidate];
  const withoutFingerprint = everyone.filter((r) => r.workflowFingerprint === undefined);
  if (withoutFingerprint.length > 0) {
    notes.push(
      `Scénario non vérifié (empreinte du workflow absente pour ${withoutFingerprint.map((r) => `« ${r.label} »`).join(", ")}) : vérifie que les tests exécutent le même scénario.`,
    );
  }

  for (const r of everyone) {
    if (r.result.generator.saturated) {
      cautions.push(`Le générateur était saturé pendant « ${r.label} » : ses latences sont peu fiables.`);
    }
    if (r.result.status === "aborted" || r.result.status === "error") {
      cautions.push(`« ${r.label} » s'est terminé en « ${r.result.status} » : ses mesures sont partielles.`);
    }
  }
  for (const base of baselines) {
    const a = base.result.durationSeconds;
    const b = candidate.result.durationSeconds;
    if (Math.min(a, b) > 0 && Math.max(a, b) / Math.min(a, b) > 2) {
      cautions.push(`Durées très différentes (${formatNumber(a, 0)} s et ${formatNumber(b, 0)} s) : « ${base.label} » et « ${candidate.label} ».`);
    }
  }

  const level = blocking.length > 0 ? "not-comparable" : cautions.length > 0 ? "partial" : "comparable";
  return { level, issues: [...blocking, ...cautions], notes };
}

// --- Métriques ------------------------------------------------------------------------------------------------------

interface MetricDef {
  key: string;
  label: string;
  unit: MetricComparison["unit"];
  better: "lower" | "higher";
  rule: "latency" | "points" | "percent";
  points?: (t: ComparisonThresholds) => number;
  value: (r: LoadRunResult) => number | null;
}

const pct = (v: number | null): number | null => (v === null ? null : v * 100);

const latency = (key: string, label: string, pick: (t: NonNullable<LoadRunResult["snapshot"]["http_req_duration"]>) => number): MetricDef => ({
  key: `latency.${key}`,
  label,
  unit: "ms",
  better: "lower",
  rule: "latency",
  value: (r) => (r.snapshot.http_req_duration ? pick(r.snapshot.http_req_duration) : null),
});

const METRICS: MetricDef[] = [
  latency("avg", "Latence moyenne", (t) => t.avg),
  latency("p50", "Latence médiane (p50)", (t) => t.med),
  latency("p90", "Latence p90", (t) => t.p90),
  latency("p95", "Latence p95", (t) => t.p95),
  latency("p99", "Latence p99", (t) => t.p99),
  {
    key: "errors.rate",
    label: "Taux d'erreur",
    unit: "%",
    better: "lower",
    rule: "points",
    points: (t) => t.errorRatePoints,
    value: (r) => pct(r.snapshot.http_req_failed.rate),
  },
  {
    key: "throughput.rate",
    label: "Débit",
    unit: "req/s",
    better: "higher",
    rule: "percent",
    value: (r) => r.snapshot.http_reqs.rate,
  },
  {
    key: "checks.rate",
    label: "Assertions réussies",
    unit: "%",
    better: "higher",
    rule: "points",
    points: (t) => t.checksPoints,
    value: (r) => pct(r.snapshot.checks.rate),
  },
  {
    key: "dropped.rate",
    label: "Itérations abandonnées",
    unit: "%",
    better: "lower",
    rule: "points",
    points: (t) => t.droppedPoints,
    value: (r) => {
      const total = r.snapshot.iterations.count + r.snapshot.dropped_iterations.count;
      return total > 0 ? (r.snapshot.dropped_iterations.count / total) * 100 : null;
    },
  },
];

/** `delta` est l'écart défavorable (ou favorable) par rapport à la valeur de référence `ref`. */
function exceeds(def: MetricDef, delta: number, ref: number, t: ComparisonThresholds): boolean {
  switch (def.rule) {
    case "latency":
      return ref > 0 && delta >= t.latencyMinMs && (delta / ref) * 100 >= t.latencyPercent;
    case "points":
      return delta >= (def.points as (t: ComparisonThresholds) => number)(t);
    case "percent":
      return ref > 0 && delta >= 1 && (delta / ref) * 100 >= t.throughputPercent;
  }
}

/**
 * Régression : le candidat est plus mauvais que le PIRE des tests de référence, d'un écart supérieur aux seuils.
 * Amélioration : le candidat est meilleur que le MEILLEUR des tests de référence. Avec plusieurs références,
 * leur variabilité sert donc de marge de bruit.
 */
function judge(def: MetricDef, baseline: number[], candidate: number, t: ComparisonThresholds): ChangeVerdict {
  const worst = def.better === "lower" ? Math.max(...baseline) : Math.min(...baseline);
  const best = def.better === "lower" ? Math.min(...baseline) : Math.max(...baseline);
  const worse = def.better === "lower" ? candidate - worst : worst - candidate;
  const better = def.better === "lower" ? best - candidate : candidate - best;

  if (exceeds(def, worse, worst, t)) return "regression";
  if (exceeds(def, better, best, t)) return "improvement";
  return "unchanged";
}

function blankMetric(key: string, label: string, unit: MetricComparison["unit"], better: MetricComparison["better"]): MetricComparison {
  return { key, label, unit, better, baseline: null, baselineRange: null, candidate: null, change: null, changePercent: null, verdict: "unknown", note: null };
}

function fillNumbers(out: MetricComparison, baselineValues: number[], candidate: number | null): void {
  if (baselineValues.length > 0) {
    out.baseline = round2(median(baselineValues) as number);
    if (baselineValues.length > 1) out.baselineRange = [round2(Math.min(...baselineValues)), round2(Math.max(...baselineValues))];
  }
  if (candidate !== null) out.candidate = round2(candidate);
  if (out.baseline !== null && out.candidate !== null) {
    out.change = round2(out.candidate - out.baseline);
    out.changePercent = out.baseline !== 0 ? round2(((out.candidate - out.baseline) / out.baseline) * 100) : null;
  }
}

function compareMetric(
  def: MetricDef,
  baselines: LoadRunRecord[],
  candidate: LoadRunRecord,
  level: RunComparison["comparability"]["level"],
  options: ComparisonOptions,
): MetricComparison {
  const out = blankMetric(def.key, def.label, def.unit, def.better);
  const baselineValues = baselines.map((r) => def.value(r.result)).filter(nonNull);
  const candidateValue = def.value(candidate.result);
  fillNumbers(out, baselineValues, candidateValue);

  if (level === "not-comparable") {
    out.note = "Charge ou scénario différent : non comparable.";
  } else if (candidateValue === null || baselineValues.length === 0) {
    out.note = "Donnée absente dans au moins un des tests.";
  } else {
    out.verdict = judge(def, baselineValues, candidateValue, options);
  }
  return out;
}

// --- Capacité observée ----------------------------------------------------------------------------------------------

function evidenceOf(record: LoadRunRecord, options: ComparisonOptions): CapacityEvidence | null {
  if (!record.points || record.points.length < 2) return null;
  const roll = rolling(record.points);
  return observedCapacity(roll, detectShape(roll), options.objectives);
}

/**
 * Compare ce que chaque test permet d'affirmer sur la capacité. Elle ne dépend pas du profil de charge :
 * un test en rampe et un autre en rampe plus haute mesurent la même chose, tant que la limite est atteinte.
 */
function compareCapacity(baselines: LoadRunRecord[], candidate: LoadRunRecord, options: ComparisonOptions): MetricComparison {
  const out = blankMetric("capacity.sustainedRps", "Capacité observée", "req/s", "higher");
  const cand = evidenceOf(candidate, options);
  const bases = baselines.map((r) => evidenceOf(r, options)).filter(nonNull);

  if (!cand || bases.length === 0) {
    out.note = "Série temporelle absente : capacité non comparée.";
    return out;
  }

  const tolerance = options.capacityPercent / 100;
  const bracketed = bases.filter((e) => e.kind === "bracketed").map((e) => e.sustainedRps as number);
  const lowerBounds = bases.filter((e) => e.kind === "lower-bound").map((e) => e.sustainedRps as number);
  const proven = [...bracketed, ...lowerBounds];

  const finish = (candidateValue: number | null, baselineValues: number[], verdict: ChangeVerdict, note: string) => {
    fillNumbers(out, baselineValues, candidateValue);
    out.verdict = verdict;
    out.note = note;
    return out;
  };

  if (cand.kind === "bracketed") {
    const s = cand.sustainedRps as number;
    if (bracketed.length > 0) {
      const worst = Math.min(...bracketed);
      const best = Math.max(...bracketed);
      let verdict: ChangeVerdict = "unchanged";
      if (worst - s >= 1 && (worst - s) / worst >= tolerance) verdict = "regression";
      else if (s - best >= 1 && (s - best) / best >= tolerance) verdict = "improvement";
      return finish(s, bracketed, verdict, "Débit maximal avant que les objectifs ne soient plus tenus.");
    }
    if (lowerBounds.length > 0) {
      const ref = Math.max(...lowerBounds);
      if (s < ref * (1 - tolerance)) {
        return finish(s, lowerBounds, "regression", `Le test de référence avait déjà prouvé une capacité d'au moins ${formatNumber(ref, 1)} req/s : le candidat en tient moins.`);
      }
      return finish(s, lowerBounds, "unknown", "La limite n'a pas été atteinte dans le test de référence : impossible de conclure.");
    }
  }

  if (cand.kind === "lower-bound") {
    const s = cand.sustainedRps as number;
    if (bracketed.length > 0) {
      const best = Math.max(...bracketed);
      if (s - best >= 1 && s >= best * (1 + tolerance)) {
        return finish(s, bracketed, "improvement", `Les objectifs sont tenus jusqu'à ${formatNumber(s, 1)} req/s sans atteindre la limite, au-dessus de la capacité mesurée avant (au moins).`);
      }
      return finish(s, bracketed, "unknown", "La limite n'a pas été atteinte dans le test candidat : la capacité est au moins égale à cette valeur.");
    }
    return finish(s, lowerBounds, "unknown", "La limite n'a été atteinte dans aucun des tests : impossible de comparer.");
  }

  if (cand.kind === "upper-bound" && proven.length > 0) {
    const b = cand.breachRps as number;
    const ref = Math.min(...proven);
    if (b < ref * (1 - tolerance)) {
      return finish(b, proven, "regression", `Les objectifs ne sont plus tenus dès ${formatNumber(b, 1)} req/s, alors que la référence en avait tenu au moins ${formatNumber(ref, 1)}.`);
    }
    return finish(b, proven, "unknown", "Les objectifs ne sont plus tenus au niveau testé : la capacité est inférieure ou égale à ce niveau.");
  }

  out.note = "Pas assez de données pour comparer la capacité.";
  return out;
}

// --- Seuils (thresholds) --------------------------------------------------------------------------------------------

function compareThresholds(baselines: LoadRunRecord[], candidate: LoadRunRecord): ThresholdChange[] {
  const keyOf = (t: { metric: string; expression: string }) => `${t.metric}|${t.expression}`;

  return candidate.result.thresholds.map((t) => {
    const prior = baselines
      .map((r) => r.result.thresholds.find((x) => keyOf(x) === keyOf(t)))
      .filter(nonNull);
    const baseline: ThresholdChange["baseline"] =
      prior.length === 0 ? "absent" : prior.every((p) => p.passed) ? "passed" : prior.every((p) => !p.passed) ? "failed" : "mixed";

    let kind: ThresholdChange["kind"] = "unchanged";
    if (!t.passed && baseline === "passed") kind = "newly-failing";
    else if (t.passed && baseline === "failed") kind = "newly-passing";

    return { metric: t.metric, expression: t.expression, baseline, candidate: t.passed ? "passed" : "failed", kind };
  });
}

// --- Assemblage -----------------------------------------------------------------------------------------------------

function describeChange(m: MetricComparison): string {
  const from = m.baseline === null ? "?" : formatNumber(m.baseline, 2);
  const to = m.candidate === null ? "?" : formatNumber(m.candidate, 2);
  if (m.unit === "%") return `${m.label} ${formatSigned(m.change ?? 0, 2)} pt (${from} → ${to} %)`;
  const percent = m.changePercent === null ? "" : ` ${formatSigned(m.changePercent, 1)} %`;
  return `${m.label}${percent} (${from} → ${to} ${m.unit})`;
}

const lowerConfidence = (c: Confidence): Confidence => (c === "high" ? "medium" : "low");

/**
 * Compare un test candidat à un ou plusieurs tests de référence.
 * Plus il y a de tests de référence, plus la confiance est grande : un seul ne permet pas de distinguer
 * une régression d'une variation normale.
 */
export function compareLoadRuns(
  baselineInput: LoadRunRecord | LoadRunRecord[],
  candidate: LoadRunRecord,
  optionsInput?: ComparisonOptionsInput,
): RunComparison {
  const baselines = Array.isArray(baselineInput) ? baselineInput : [baselineInput];
  if (baselines.length === 0) throw new ComparisonInputError("Au moins un test de référence est nécessaire.");

  const options = resolveOptions(optionsInput);
  const comparability = assessComparability(baselines, candidate);
  const { level } = comparability;

  const metrics = [
    ...METRICS.map((def) => compareMetric(def, baselines, candidate, level, options)),
    compareCapacity(baselines, candidate, options),
  ];
  const thresholds = compareThresholds(baselines, candidate);

  // Les seuils dépendent de la charge : ils ne comptent que si les tests sont comparables.
  const thresholdsCount = level !== "not-comparable";
  const regressions = [
    ...metrics.filter((m) => m.verdict === "regression").map(describeChange),
    ...(thresholdsCount
      ? thresholds.filter((t) => t.kind === "newly-failing").map((t) => `Seuil « ${t.expression} » (${t.metric}) : respecté avant, en échec maintenant`)
      : []),
  ];
  const improvements = [
    ...metrics.filter((m) => m.verdict === "improvement").map(describeChange),
    ...(thresholdsCount
      ? thresholds.filter((t) => t.kind === "newly-passing").map((t) => `Seuil « ${t.expression} » (${t.metric}) : en échec avant, respecté maintenant`)
      : []),
  ];

  const hasSignal = metrics.some((m) => m.verdict !== "unknown") || (thresholdsCount && thresholds.length > 0);
  const overall: RunComparison["overall"] =
    regressions.length > 0 ? "regression" : !hasSignal ? "inconclusive" : improvements.length > 0 ? "improvement" : "no-change";

  const summary = {
    regression: `Régression détectée : ${regressions.slice(0, 3).join(" ; ")}.`,
    improvement: `Amélioration : ${improvements.slice(0, 3).join(" ; ")}.`,
    "no-change": `Aucun écart significatif par rapport à la référence (latence : ±${options.latencyPercent} % et ${options.latencyMinMs} ms, taux d'erreur : ±${formatNumber(options.errorRatePoints, 1)} pt).`,
    inconclusive: `Comparaison non concluante : ${comparability.issues[0] ?? "pas assez de données comparables"}`,
  }[overall];

  let confidence: Confidence = baselines.length >= 3 ? "high" : baselines.length === 2 ? "medium" : "low";
  if (level === "partial") confidence = lowerConfidence(confidence);
  if (level === "not-comparable") confidence = "low";

  const notes = [...comparability.notes];
  if (baselines.length === 1) {
    notes.push("Un seul test de référence : un écart peut être du bruit de mesure. Avec plusieurs tests de référence, une régression doit dépasser le pire d'entre eux.");
  }
  const environments = [...new Set([...baselines, candidate].map((r) => r.environment).filter(nonNull))];
  if (environments.length > 1) {
    notes.push(`Comparaison entre environnements : ${environments.join(" et ")}. Un écart peut venir de la configuration plutôt que du code.`);
  }

  const identity = (r: LoadRunRecord) => ({ label: r.label, environment: r.environment ?? null });
  return {
    overall,
    summary,
    comparability: { level, issues: comparability.issues },
    confidence,
    baselineCount: baselines.length,
    baselines: baselines.map(identity),
    candidate: identity(candidate),
    metrics,
    thresholds,
    regressions,
    improvements,
    notes,
    options,
  };
}