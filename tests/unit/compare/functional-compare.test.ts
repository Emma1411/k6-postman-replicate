import { describe, expect, it } from "vitest";
import { compareWorkflowRuns } from "@/shared/compare/functional";
import type { AssertionResult, StepResult, StepStatus, WorkflowRunResult } from "@/shared/types/workflow-result";

const assertion = (label: string, passed: boolean, message: string | null = null): AssertionResult => ({
  label,
  type: "status",
  passed,
  message: passed ? null : message,
});

function step(id: string, status: StepStatus, extra: Partial<StepResult> = {}): StepResult {
  return {
    stepId: id,
    name: `Étape ${id}`,
    status,
    skippedReason: status === "skipped" ? "arrêté" : null,
    response: status === "skipped" || status === "error" ? null : { status: 200, durationMs: 100, sizeBytes: 1, finalUrl: null, truncated: false, preview: null },
    assertions: [],
    extracted: {},
    extractionErrors: [],
    error: status === "error" ? { code: "TIMEOUT", message: "trop long" } : null,
    ...extra,
  };
}

function run(steps: StepResult[]): WorkflowRunResult {
  const failed = steps.some((s) => s.status === "failed" || s.status === "error");
  return {
    workflow: "w",
    status: failed ? "failed" : "passed",
    stoppedAtStepId: null,
    aborted: false,
    durationMs: 100,
    summary: { steps: steps.length, passed: 0, failed: 0, errors: 0, skipped: 0, assertionsPassed: 0, assertionsFailed: 0 },
    steps,
    variables: {},
  };
}

describe("compareWorkflowRuns", () => {
  it("ne signale rien pour deux exécutions identiques", () => {
    const r = run([step("a", "passed"), step("b", "passed")]);
    const c = compareWorkflowRuns(r, r);
    expect(c.overall).toBe("no-change");
    expect(c.summary).toBe("Aucun changement de résultat.");
    expect(c.steps).toEqual([]);
    expect(c.slower).toEqual([]);
  });

  it("détecte une étape qui passait et échoue maintenant, avec l'assertion fautive", () => {
    const base = run([step("a", "passed", { assertions: [assertion("Statut 200", true)] })]);
    const cand = run([step("a", "failed", { assertions: [assertion("Statut 200", false, "Statut attendu 200, reçu 500.")] })]);
    const c = compareWorkflowRuns(base, cand);

    expect(c.overall).toBe("regression");
    expect(c.status).toEqual({ baseline: "passed", candidate: "failed" });
    expect(c.steps).toEqual([
      {
        stepId: "a",
        name: "Étape a",
        kind: "newly-failing",
        baselineStatus: "passed",
        candidateStatus: "failed",
        changes: ["« Statut 200 » échoue maintenant : Statut attendu 200, reçu 500."],
      },
    ]);
    expect(c.summary).toBe("Régression : 1 étape(s) en échec alors qu'elles passaient avant (« Étape a »).");
  });

  it("détecte une étape corrigée", () => {
    const base = run([step("a", "failed", { assertions: [assertion("Statut 200", false, "x")] })]);
    const cand = run([step("a", "passed", { assertions: [assertion("Statut 200", true)] })]);
    const c = compareWorkflowRuns(base, cand);
    expect(c.overall).toBe("improvement");
    expect(c.steps[0].kind).toBe("fixed");
    expect(c.steps[0].changes).toEqual(["« Statut 200 » est corrigée"]);
    expect(c.summary).toContain("1 étape(s) corrigée(s)");
  });

  it("signale une erreur d'exécution", () => {
    const c = compareWorkflowRuns(run([step("a", "passed")]), run([step("a", "error")]));
    expect(c.overall).toBe("regression");
    expect(c.steps[0].changes).toEqual(["Erreur : trop long"]);
  });

  it("compte une nouvelle assertion en échec même dans une étape qui échouait déjà", () => {
    const base = run([step("a", "failed", { assertions: [assertion("A", false, "x"), assertion("B", true)] })]);
    const cand = run([step("a", "failed", { assertions: [assertion("A", true), assertion("B", false, "y")] })]);
    const c = compareWorkflowRuns(base, cand);
    expect(c.overall).toBe("regression");
    expect(c.steps[0].kind).toBe("assertions-changed");
    expect(c.steps[0].changes).toEqual(["« A » est corrigée", "« B » échoue maintenant : y"]);
    expect(c.summary).toContain("1 assertion(s)");
  });

  it("distingue des assertions de même libellé par leur rang", () => {
    const base = run([step("a", "failed", { assertions: [assertion("Statut", true), assertion("Statut", false, "x")] })]);
    const cand = run([step("a", "failed", { assertions: [assertion("Statut", false, "z"), assertion("Statut", false, "x")] })]);
    const c = compareWorkflowRuns(base, cand);
    expect(c.steps[0].changes).toEqual(["« Statut » échoue maintenant : z"]);
  });

  it("signale les étapes sautées ou exécutées, sans en faire une régression en soi", () => {
    const base = run([step("a", "passed"), step("b", "passed")]);
    const cand = run([step("a", "passed"), step("b", "skipped")]);
    const c = compareWorkflowRuns(base, cand);
    expect(c.steps.map((s) => s.kind)).toEqual(["newly-skipped"]);
    expect(c.overall).toBe("no-change");
  });

  it("liste les étapes ajoutées et retirées", () => {
    const c = compareWorkflowRuns(run([step("a", "passed"), step("old", "passed")]), run([step("a", "passed"), step("new", "passed")]));
    expect(c.added).toEqual(["Étape new"]);
    expect(c.removed).toEqual(["Étape old"]);
    expect(c.notes.join(" ")).toContain("Étapes ajoutées");
    expect(c.notes.join(" ")).toContain("Étapes retirées");
    expect(c.overall).toBe("no-change");
  });

  it("signale les étapes nettement plus lentes, sans en faire une régression", () => {
    const timed = (id: string, ms: number) => step(id, "passed", { response: { status: 200, durationMs: ms, sizeBytes: 1, finalUrl: null, truncated: false, preview: null } });
    const base = run([timed("lent", 100), timed("peu", 100), timed("relatif", 1000)]);
    const cand = run([timed("lent", 400), timed("peu", 160), timed("relatif", 1400)]);
    const c = compareWorkflowRuns(base, cand);

    expect(c.slower).toEqual([{ stepId: "lent", name: "Étape lent", baselineMs: 100, candidateMs: 400, changePercent: 300 }]);
    expect(c.overall).toBe("no-change");
    expect(c.notes.join(" ")).toContain("test de charge");
  });

  it("applique les seuils de durée fournis", () => {
    const timed = (ms: number) => run([step("a", "passed", { response: { status: 200, durationMs: ms, sizeBytes: 1, finalUrl: null, truncated: false, preview: null } })]);
    expect(compareWorkflowRuns(timed(100), timed(160), { durationMinMs: 50, durationPercent: 50 }).slower).toHaveLength(1);
  });
});