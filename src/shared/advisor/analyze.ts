import type { NormalizedAnalyzeInput } from "@/shared/schemas";
import type { AnalyzeResult, Confidence, DataQuality } from "@/shared/types/advisor-result";
import { detectShape, observedCapacity, summarizeRun } from "./capacity-evidence";
import { buildRecommendations } from "./recommendations";
import { runRules, type RuleContext } from "./rules";
import { alignSeries, baselineP95, medianStep, rolling } from "./series";

const LEVELS: Confidence[] = ["low", "medium", "high"];
const lower = (c: Confidence): Confidence => LEVELS[Math.max(0, LEVELS.indexOf(c) - 1)];

function prepare(run: NormalizedAnalyzeInput["run"], input: NormalizedAnalyzeInput) {
  const points = [...run.points].sort((a, b) => a.t - b.t);
  const roll = rolling(points);
  const shape = detectShape(roll);
  const aligned = alignSeries(points, run.infraMetrics?.samples ?? [], input.policy.maxAlignGapSeconds);
  return { points, roll, shape, aligned };
}

/** Analyse un test de charge : constats, recommandations et capacité observée. Fonction pure. */
export function analyzeRun(input: NormalizedAnalyzeInput): AnalyzeResult {
  const { run, objectives, policy } = input;
  const { points, roll, shape, aligned } = prepare(run, input);

  const baseline = baselineP95(aligned, shape);
  const summary = summarizeRun(points, roll, baseline);
  const capacity = observedCapacity(roll, shape, objectives);

  const others = input.otherRuns.map((other) => {
    const prepared = prepare(other, input);
    return { run: other, capacity: observedCapacity(prepared.roll, prepared.shape, objectives) };
  });

  const ctx: RuleContext = {
    run,
    aligned,
    policy,
    objectives,
    summary,
    capacity,
    shape,
    step: medianStep(points),
    baselineP95: baseline,
    provenance: run.infraMetrics?.provenance ?? null,
    others,
  };

  let findings = runRules(ctx);
  // Un générateur saturé fausse les mesures : toutes les autres conclusions perdent un niveau de confiance.
  if (run.generatorSaturated) {
    findings = findings.map((f) => (f.code === "generator-saturated" ? f : { ...f, confidence: lower(f.confidence) }));
  }

  const missing: string[] = [];
  if (!aligned.some((p) => p.cpu !== null)) missing.push("CPU");
  if (!aligned.some((p) => p.mem !== null)) missing.push("mémoire");
  const poolKnown = run.infra.poolSizePerInstance !== undefined || run.infra.dbMaxConnections !== undefined;
  if (!aligned.some((p) => p.dbUsed !== null) || !poolKnown) missing.push("connexions DB (utilisées et capacité du pool)");
  if (!aligned.some((p) => p.rtt !== null)) missing.push("latence réseau (RTT)");

  const warnings: string[] = [];
  if (run.generatorSaturated) warnings.push("Le générateur était saturé : les latences mesurées sont peu fiables.");
  if (run.infra.instances > 1 && run.infraMetrics) {
    warnings.push("Les métriques d'infrastructure sont des moyennes sur les instances : une instance saturée peut être masquée par les autres.");
  }
  if (objectives.p95MaxMs === undefined) warnings.push("Aucun objectif de p95 défini : la capacité est évaluée sur le taux d'erreur seulement.");

  const dataQuality: DataQuality = {
    infraMetrics: run.infraMetrics?.provenance ?? "none",
    missingMetrics: missing,
    reliable: !run.generatorSaturated,
    warnings,
  };

  return {
    advisoryOnly: true,
    summary,
    capacity,
    findings,
    recommendations: buildRecommendations(findings, capacity, objectives),
    dataQuality,
    policy,
  };
}