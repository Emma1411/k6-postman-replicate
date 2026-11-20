import type { StoredLoadResult } from "@/client/storage/db";
import { objectivesFromThresholds, toMeasuredRun } from "@/client/features/load/verdict";
import { analyzeRun } from "@/shared/advisor/analyze";
import { ObjectivesSchema, normalizeAnalyzeInput, type InfraMetrics } from "@/shared/schemas";
import type { AnalyzeResult, Confidence, DataSource, Finding, Severity } from "@/shared/types/advisor-result";
import { toInfraSpec, validateInfra, type InfraDraft } from "./infra";

export interface AnalysisInputs {
  stored: StoredLoadResult;
  /** null : architecture non renseignée, certains constats ne peuvent pas être calculés. */
  infra: InfraDraft | null;
  metrics: InfraMetrics | null;
  /** Le débit visé, s'il est connu (améliore le constat « charge insuffisante »). */
  targetRps?: number | null;
}

export type AnalysisOutcome = { ok: true; result: AnalyzeResult } | { ok: false; reason: string };

export function analyzeStored({ stored, infra, metrics, targetRps }: AnalysisInputs): AnalysisOutcome {
  const run = toMeasuredRun(stored.points, stored.result.generator.saturated, stored.result.name.slice(0, 100), {
    infra: infra && validateInfra(infra).length === 0 ? toInfraSpec(infra) : undefined,
    infraMetrics: metrics ?? undefined,
  });
  if (!run) return { ok: false, reason: "Ce test contient moins de deux secondes de mesures : il est trop court pour être analysé." };
  try {
    const objectives = ObjectivesSchema.parse({
      ...objectivesFromThresholds(stored.scenario?.thresholds ?? []),
      ...(targetRps ? { targetRps } : {}),
    });
    return { ok: true, result: analyzeRun(normalizeAnalyzeInput({ run, objectives })) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "L'analyse a échoué." };
  }
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/** Du plus grave au moins grave, puis du plus fiable au moins fiable. L'ordre d'origine départage. */
export function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
        CONFIDENCE_RANK[a.finding.confidence] - CONFIDENCE_RANK[b.finding.confidence] ||
        a.index - b.index,
    )
    .map((x) => x.finding);
}

export const severityLabel = (s: Severity): string => (s === "critical" ? "Haute" : s === "warning" ? "Moyenne" : "Information");
export const confidenceLabel = (c: Confidence): string => (c === "high" ? "Élevée" : c === "medium" ? "Moyenne" : "Faible");

export interface Provenance {
  kind: "measured" | "user";
  label: string;
}

/** D'où viennent les données d'un constat. null : aucune donnée utilisée. */
export function provenanceOf(source: DataSource): Provenance | null {
  switch (source) {
    case "observed":
      return { kind: "measured", label: "Mesuré (Prometheus)" };
    case "user-provided":
      return { kind: "user", label: "Fourni par toi" };
    case "load-results":
      return { kind: "measured", label: "Mesuré (test de charge)" };
    default:
      return null;
  }
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}