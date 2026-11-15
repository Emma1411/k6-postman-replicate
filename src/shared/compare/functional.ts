import type { StepChange, StepTiming, WorkflowComparison } from "@/shared/types/comparison-result";
import type { AssertionResult, StepResult, StepStatus, WorkflowRunResult } from "@/shared/types/workflow-result";
import { round1 } from "../advisor/stats";

export interface WorkflowComparisonOptions {
  /** Une étape est « nettement plus lente » si elle dépasse ces deux seuils. */
  durationPercent: number;
  durationMinMs: number;
}

const DEFAULTS: WorkflowComparisonOptions = { durationPercent: 50, durationMinMs: 100 };

const isBad = (s: StepStatus): boolean => s === "failed" || s === "error";

/** Clé « libellé#n » : deux assertions de même libellé restent distinguées par leur rang. */
function indexAssertions(assertions: AssertionResult[]): Map<string, AssertionResult> {
  const seen = new Map<string, number>();
  const out = new Map<string, AssertionResult>();
  for (const a of assertions) {
    const n = seen.get(a.label) ?? 0;
    seen.set(a.label, n + 1);
    out.set(`${a.label}#${n}`, a);
  }
  return out;
}

function stepKind(base: StepStatus, cand: StepStatus): StepChange["kind"] | null {
  if (!isBad(base) && isBad(cand)) return "newly-failing";
  if (isBad(base) && cand === "passed") return "fixed";
  if (base !== "skipped" && cand === "skipped") return "newly-skipped";
  if (base === "skipped" && cand !== "skipped") return "newly-run";
  return null;
}

/**
 * Compare deux exécutions d'un même workflow : étapes devenues en échec ou corrigées, assertions qui changent,
 * étapes ajoutées ou retirées, étapes nettement plus lentes. Les étapes sont rapprochées par identifiant.
 */
export function compareWorkflowRuns(
  baseline: WorkflowRunResult,
  candidate: WorkflowRunResult,
  input: Partial<WorkflowComparisonOptions> = {},
): WorkflowComparison {
  const options = { ...DEFAULTS, ...input };
  const baseById = new Map(baseline.steps.map((s) => [s.stepId, s]));
  const candIds = new Set(candidate.steps.map((s) => s.stepId));

  const steps: StepChange[] = [];
  const slower: StepTiming[] = [];
  const added: string[] = [];
  let newAssertionFailures = 0;

  for (const cand of candidate.steps) {
    const base: StepResult | undefined = baseById.get(cand.stepId);
    if (!base) {
      added.push(cand.name);
      continue;
    }

    const changes: string[] = [];
    const baseAssertions = indexAssertions(base.assertions);
    for (const [key, c] of indexAssertions(cand.assertions)) {
      const b = baseAssertions.get(key);
      if (!b) continue;
      if (b.passed && !c.passed) {
        newAssertionFailures++;
        changes.push(`« ${c.label} » échoue maintenant${c.message ? ` : ${c.message}` : ""}`);
      } else if (!b.passed && c.passed) {
        changes.push(`« ${c.label} » est corrigée`);
      }
    }
    if (cand.status === "error" && base.status !== "error" && cand.error) changes.push(`Erreur : ${cand.error.message}`);

    const kind = stepKind(base.status, cand.status);
    if (kind || changes.length > 0) {
      steps.push({
        stepId: cand.stepId,
        name: cand.name,
        kind: kind ?? "assertions-changed",
        baselineStatus: base.status,
        candidateStatus: cand.status,
        changes,
      });
    }

    if (base.response && cand.response && base.status !== "skipped" && cand.status !== "skipped") {
      const increase = cand.response.durationMs - base.response.durationMs;
      const percent = base.response.durationMs > 0 ? (increase / base.response.durationMs) * 100 : 0;
      if (increase >= options.durationMinMs && percent >= options.durationPercent) {
        slower.push({
          stepId: cand.stepId,
          name: cand.name,
          baselineMs: round1(base.response.durationMs),
          candidateMs: round1(cand.response.durationMs),
          changePercent: round1(percent),
        });
      }
    }
  }

  const removed = baseline.steps.filter((s) => !candIds.has(s.stepId)).map((s) => s.name);

  const newlyFailing = steps.filter((s) => s.kind === "newly-failing");
  const fixed = steps.filter((s) => s.kind === "fixed");
  const regressed = newlyFailing.length > 0 || newAssertionFailures > 0 || (baseline.status === "passed" && candidate.status === "failed");
  const improved = !regressed && (fixed.length > 0 || (baseline.status === "failed" && candidate.status === "passed"));
  const overall: WorkflowComparison["overall"] = regressed ? "regression" : improved ? "improvement" : "no-change";

  const names = (list: StepChange[]) => list.slice(0, 3).map((s) => `« ${s.name} »`).join(", ");
  const summary = regressed
    ? newlyFailing.length > 0
      ? `Régression : ${newlyFailing.length} étape(s) en échec alors qu'elles passaient avant (${names(newlyFailing)}).`
      : `Régression : ${newAssertionFailures} assertion(s) qui passaient avant échouent maintenant.`
    : improved
      ? `Amélioration : ${fixed.length} étape(s) corrigée(s)${fixed.length > 0 ? ` (${names(fixed)})` : ""}.`
      : "Aucun changement de résultat.";

  const notes: string[] = [];
  if (slower.length > 0) {
    notes.push(
      `${slower.length} étape(s) nettement plus lentes (${slower.slice(0, 3).map((s) => `« ${s.name} » ${s.baselineMs} → ${s.candidateMs} ms`).join(", ")}). Une mesure unique est indicative : pour une vraie comparaison de performance, utilise un test de charge.`,
    );
  }
  if (added.length > 0) notes.push(`Étapes ajoutées : ${added.map((n) => `« ${n} »`).join(", ")}.`);
  if (removed.length > 0) notes.push(`Étapes retirées : ${removed.map((n) => `« ${n} »`).join(", ")}.`);

  return {
    overall,
    summary,
    status: { baseline: baseline.status, candidate: candidate.status },
    steps,
    slower,
    added,
    removed,
    notes,
  };
}