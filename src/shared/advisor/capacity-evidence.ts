import type { LoadPoint, Objectives } from "@/shared/schemas";
import type { CapacityEvidence, RunSummary } from "@/shared/types/advisor-result";
import { type RollingPoint } from "./series";
import { max, percentile, round1, round4, sum } from "./stats";
export type Shape = "variable" | "constant";

/** Charge variable (rampe, paliers) ou constante, d'après l'étendue du débit lissé. */
export function detectShape(roll: RollingPoint[]): Shape {
  const values = roll.map((r) => r.rps).filter((v) => v > 0);
  if (values.length < 3) return "constant";
  const p10 = percentile(values, 10) as number;
  const p90 = percentile(values, 90) as number;
  return p90 >= 2 * p10 ? "variable" : "constant";
}

export function summarizeRun(points: LoadPoint[], roll: RollingPoint[], baselineP95Ms: number | null): RunSummary {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const totalRequests = sum(sorted.map((p) => p.requests));
  const totalFailed = sum(sorted.map((p) => p.failed));
  const duration = sorted[sorted.length - 1].t;
  const p95s = roll.flatMap((r) => (r.p95 !== null ? [r.p95] : []));

  return {
    durationSeconds: round1(duration),
    totalRequests,
    totalFailed,
    errorRate: totalRequests > 0 ? round4(totalFailed / totalRequests) : null,
    avgRps: duration > 0 ? round1(totalRequests / duration) : 0,
    peakRps: round1(max(roll.map((r) => r.rps))),
    maxVus: max(sorted.map((p) => p.vus)),
    baselineP95Ms: baselineP95Ms === null ? null : round1(baselineP95Ms),
    peakP95Ms: p95s.length > 0 ? round1(max(p95s)) : null,
    droppedIterations: sum(sorted.map((p) => p.dropped)),
  };
}

/** Capacité que le test permet d'affirmer, d'après le respect des objectifs (p95 et taux d'erreur) au fil de la charge. */
export function observedCapacity(roll: RollingPoint[], shape: Shape, objectives: Objectives): CapacityEvidence {
  if (roll.length === 0) {
    return {
      kind: "unknown",
      sustainedRps: null,
      breachRps: null,
      shape,
      loadRange: { minRps: 0, maxRps: 0 },
      basis: "Pas assez de données pour évaluer la capacité.",
    };
  }

  const rates = roll.map((r) => r.rps);
  const loadRange = { minRps: round1(Math.min(...rates)), maxRps: round1(max(rates)) };
  const slo = objectives.p95MaxMs;
  const sloNote =
    slo === undefined ? " Aucun objectif de p95 n'est défini : la capacité est évaluée sur le taux d'erreur seulement." : "";

  const isOk = (r: RollingPoint) =>
    (slo === undefined || r.p95 === null || r.p95 <= slo) &&
    (r.errorRate === null || r.errorRate <= objectives.maxErrorRate);

  const firstBreach = roll.findIndex((r) => !isOk(r));
  const peak = round1(max(rates));

  if (firstBreach === -1) {
    return {
      kind: "lower-bound",
      sustainedRps: peak,
      breachRps: null,
      shape,
      loadRange,
      basis: `Les objectifs ont été respectés pendant tout le test, jusqu'à ${peak} req/s : la limite n'a pas été atteinte, la capacité est au moins égale à cette valeur.${sloNote}`,
    };
  }

  if (shape === "constant") {
    const level = round1(roll[firstBreach].rps);
    return {
      kind: "upper-bound",
      sustainedRps: null,
      breachRps: level,
      shape,
      loadRange,
      basis: `Charge constante autour de ${level} req/s, et les objectifs ne sont pas tenus : la capacité est inférieure ou égale à ce niveau. Relance un test en rampe pour la situer.${sloNote}`,
    };
  }

  const before = roll.slice(0, firstBreach).map((r) => r.rps);
  const breachRps = round1(roll[firstBreach].rps);
  if (before.length === 0) {
    return {
      kind: "upper-bound",
      sustainedRps: null,
      breachRps,
      shape,
      loadRange,
      basis: `Les objectifs ne sont plus respectés dès le début du test (${breachRps} req/s) : la capacité est inférieure à ce niveau.${sloNote}`,
    };
  }

  const sustainedRps = round1(max(before));
  return {
    kind: "bracketed",
    sustainedRps,
    breachRps,
    shape,
    loadRange,
    basis: `Objectifs respectés jusqu'à ${sustainedRps} req/s, premier dépassement à ${breachRps} req/s : la capacité observée est dans cet intervalle.${sloNote}`,
  };
}