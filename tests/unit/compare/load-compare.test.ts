import { describe, expect, it } from "vitest";
import { compareLoadRuns, ComparisonInputError } from "@/shared/compare/load";
import { formatNumber } from "@/shared/format";
import type { RunComparison } from "@/shared/types/comparison-result";
import { latencyKnee, makeRun, ramp } from "../../helpers/advisor-fixtures";
import { record, threshold } from "../../helpers/compare-fixtures";

const metric = (c: RunComparison, key: string) => c.metrics.find((m) => m.key === key)!;

describe("tests identiques", () => {
  const c = compareLoadRuns(record({ label: "v1" }), record({ label: "v2" }));

  it("ne signale rien", () => {
    expect(c.overall).toBe("no-change");
    expect(c.regressions).toEqual([]);
    expect(c.improvements).toEqual([]);
    expect(c.comparability.level).toBe("comparable");
    expect(c.metrics.filter((m) => m.verdict !== "unknown").every((m) => m.verdict === "unchanged")).toBe(true);
    expect(c.summary).toContain("Aucun écart significatif");
  });

  it("indique que la capacité n'a pas pu être comparée sans série temporelle", () => {
    const capacity = metric(c, "capacity.sustainedRps");
    expect(capacity.verdict).toBe("unknown");
    expect(capacity.note).toContain("Série temporelle absente");
  });

  it("garde une confiance faible avec un seul test de référence, et le dit", () => {
    expect(c.confidence).toBe("low");
    expect(c.baselineCount).toBe(1);
    expect(c.notes.join(" ")).toContain("Un seul test de référence");
    expect(c.notes.join(" ")).toContain("empreinte"); // scénario non vérifié
  });
});

describe("latence", () => {
  it("détecte une régression du p95 et la décrit", () => {
    const c = compareLoadRuns(record({ p95: 200 }), record({ p95: 260 }));
    const p95 = metric(c, "latency.p95");
    expect(p95).toMatchObject({ baseline: 200, candidate: 260, change: 60, changePercent: 30, verdict: "regression" });
    expect(metric(c, "latency.p99").verdict).toBe("unchanged");
    expect(c.overall).toBe("regression");
    expect(c.regressions).toEqual([`Latence p95 +30 % (200 → 260 ms)`]);
    expect(c.summary).toBe("Régression détectée : Latence p95 +30 % (200 → 260 ms).");
  });

  it.each([
    [200, 215, "unchanged"], // +7,5 % : sous le seuil relatif
    [200, 225, "regression"], // +25 ms et +12,5 %
    [100, 118, "unchanged"], // +18 % mais seulement +18 ms : sous le seuil absolu
    [100, 122, "regression"],
    [300, 285, "unchanged"],
    [300, 250, "improvement"],
  ])("p95 %i → %i : %s", (from, to, expected) => {
    expect(metric(compareLoadRuns(record({ p95: from }), record({ p95: to })), "latency.p95").verdict).toBe(expected);
  });

  it("décrit une amélioration", () => {
    const c = compareLoadRuns(record({ p95: 300 }), record({ p95: 200 }));
    expect(c.overall).toBe("improvement");
    expect(c.summary).toBe(`Amélioration : Latence p95 ${"-33,3"} % (300 → 200 ms).`);
  });

  it("applique les seuils fournis", () => {
    const base = record({ p95: 200 });
    const cand = record({ p95: 260 });
    expect(metric(compareLoadRuns(base, cand), "latency.p95").verdict).toBe("regression");
    expect(metric(compareLoadRuns(base, cand, { latencyPercent: 50 }), "latency.p95").verdict).toBe("unchanged");
    expect(metric(compareLoadRuns(base, cand, { latencyMinMs: 100 }), "latency.p95").verdict).toBe("unchanged");
  });
});

describe("erreurs, débit, assertions, itérations abandonnées", () => {
  it("compare le taux d'erreur en points de pourcentage", () => {
    const worse = metric(compareLoadRuns(record({ errorRate: 0.002 }), record({ errorRate: 0.01 })), "errors.rate");
    expect(worse).toMatchObject({ baseline: 0.2, candidate: 1, change: 0.8, verdict: "regression" });

    expect(metric(compareLoadRuns(record({ errorRate: 0.002 }), record({ errorRate: 0.005 })), "errors.rate").verdict).toBe("unchanged");
    expect(metric(compareLoadRuns(record({ errorRate: 0.01 }), record({ errorRate: 0.002 })), "errors.rate").verdict).toBe("improvement");
  });

  it("détecte une baisse de débit", () => {
    expect(metric(compareLoadRuns(record({ rps: 500 }), record({ rps: 420 })), "throughput.rate").verdict).toBe("regression");
    expect(metric(compareLoadRuns(record({ rps: 500 }), record({ rps: 480 })), "throughput.rate").verdict).toBe("unchanged");
    expect(metric(compareLoadRuns(record({ rps: 500 }), record({ rps: 560 })), "throughput.rate").verdict).toBe("improvement");
  });

  it("détecte une baisse du taux d'assertions réussies", () => {
    expect(metric(compareLoadRuns(record({ checksRate: 1 }), record({ checksRate: 0.97 })), "checks.rate").verdict).toBe("regression");
    expect(metric(compareLoadRuns(record({ checksRate: 1 }), record({ checksRate: 0.995 })), "checks.rate").verdict).toBe("unchanged");
  });

  it("détecte des itérations abandonnées", () => {
    const m = metric(compareLoadRuns(record({ dropped: 0 }), record({ dropped: 300 })), "dropped.rate");
    expect(m.verdict).toBe("regression");
    expect(m.candidate).toBeCloseTo(5.66, 2); // 300 / 5 300
    expect(metric(compareLoadRuns(record({ iterations: 0 }), record({ iterations: 0 })), "dropped.rate").verdict).toBe("unknown");
  });
});

describe("plusieurs tests de référence", () => {
  const baselines = [record({ label: "a", p95: 200 }), record({ label: "b", p95: 220 }), record({ label: "c", p95: 240 })];

  it("utilise le pire des tests de référence comme marge de bruit", () => {
    const within = compareLoadRuns(baselines, record({ p95: 250 }));
    expect(metric(within, "latency.p95").verdict).toBe("unchanged"); // 250 est à 10 ms du pire (240)

    const beyond = compareLoadRuns(baselines, record({ p95: 280 }));
    const p95 = metric(beyond, "latency.p95");
    expect(p95).toMatchObject({ baseline: 220, baselineRange: [200, 240], candidate: 280, change: 60, verdict: "regression" });
  });

  it("n'annonce une amélioration que si le candidat bat le meilleur", () => {
    expect(metric(compareLoadRuns(baselines, record({ p95: 190 })), "latency.p95").verdict).toBe("unchanged"); // 10 ms sous le meilleur
    expect(metric(compareLoadRuns(baselines, record({ p95: 150 })), "latency.p95").verdict).toBe("improvement");
  });

  it("augmente la confiance avec le nombre de références", () => {
    expect(compareLoadRuns(baselines.slice(0, 2), record()).confidence).toBe("medium");
    expect(compareLoadRuns(baselines, record()).confidence).toBe("high");
    expect(compareLoadRuns(baselines, record()).notes.join(" ")).not.toContain("Un seul test");
  });

  it("exige au moins un test de référence", () => {
    expect(() => compareLoadRuns([], record())).toThrow(ComparisonInputError);
  });
});

describe("comparabilité", () => {
  it("refuse de comparer des charges différentes, sans fausse régression", () => {
    const c = compareLoadRuns(
      record({ label: "50 VUs", p95: 200 }),
      record({ label: "100 VUs", p95: 600, executor: { type: "constant-vus", vus: 100, durationSeconds: 60 } }),
    );
    expect(c.comparability.level).toBe("not-comparable");
    expect(c.comparability.issues[0]).toContain("constant-vus : 50 VUs");
    expect(c.comparability.issues[0]).toContain("constant-vus : 100 VUs");
    expect(metric(c, "latency.p95")).toMatchObject({ verdict: "unknown", note: "Charge ou scénario différent : non comparable." });
    expect(c.overall).toBe("inconclusive");
    expect(c.summary.startsWith("Comparaison non concluante")).toBe(true);
    expect(c.confidence).toBe("low");
  });

  it("distingue les types d'executors", () => {
    const c = compareLoadRuns(
      record(),
      record({ executor: { type: "ramping-vus", stages: [{ durationSeconds: 30, target: 50 }] } }),
    );
    expect(c.comparability.issues[0]).toContain("ramping-vus");
    expect(c.comparability.issues[0]).toContain("constant-vus");
  });

  it("accepte une durée différente pour la même charge, avec réserve si l'écart est grand", () => {
    expect(compareLoadRuns(record({ durationSeconds: 60 }), record({ durationSeconds: 100 })).comparability.level).toBe("comparable");

    const c = compareLoadRuns(record({ durationSeconds: 60 }), record({ durationSeconds: 200 }));
    expect(c.comparability.level).toBe("partial");
    expect(c.comparability.issues.join(" ")).toContain("Durées très différentes");
  });

  it("signale un générateur saturé ou un test interrompu, et baisse la confiance", () => {
    const base = [record({ label: "a" }), record({ label: "b" }), record({ label: "c" })];
    const saturated = compareLoadRuns(base, record({ label: "x", saturated: true }));
    expect(saturated.comparability.level).toBe("partial");
    expect(saturated.comparability.issues.join(" ")).toContain("saturé");
    expect(saturated.confidence).toBe("medium"); // « high » avec 3 références, abaissé d'un niveau

    const aborted = compareLoadRuns(record(), record({ label: "x", status: "aborted" }));
    expect(aborted.comparability.issues.join(" ")).toContain("aborted");
    expect(aborted.confidence).toBe("low");
  });

  it("vérifie l'empreinte du workflow quand elle existe", () => {
    const different = compareLoadRuns(record({ fingerprint: "abc" }), record({ fingerprint: "def" }));
    expect(different.comparability.level).toBe("not-comparable");
    expect(different.comparability.issues[0]).toContain("Scénario différent");

    const same = compareLoadRuns(record({ fingerprint: "abc" }), record({ fingerprint: "abc" }));
    expect(same.comparability.level).toBe("comparable");
    expect(same.notes.join(" ")).not.toContain("empreinte");
  });

  it("note une comparaison entre environnements", () => {
    const c = compareLoadRuns(record({ environment: "staging" }), record({ environment: "production" }));
    expect(c.notes.join(" ")).toContain("entre environnements : staging et production");
    expect(c.baselines[0]).toEqual({ label: "test", environment: "staging" });
    expect(c.candidate.environment).toBe("production");
  });
});

describe("seuils (thresholds)", () => {
  const passing = [threshold("http_req_duration", "p(95)<500", true)];
  const failing = [threshold("http_req_duration", "p(95)<500", false)];

  it("signale un seuil devenu en échec comme une régression, même si les métriques n'ont pas bougé", () => {
    const c = compareLoadRuns(record({ thresholds: passing }), record({ thresholds: failing }));
    expect(c.thresholds[0]).toMatchObject({ kind: "newly-failing", baseline: "passed", candidate: "failed" });
    expect(c.overall).toBe("regression");
    expect(c.regressions[0]).toContain("p(95)<500");
  });

  it("signale un seuil devenu respecté comme une amélioration", () => {
    const c = compareLoadRuns(record({ thresholds: failing }), record({ thresholds: passing }));
    expect(c.thresholds[0].kind).toBe("newly-passing");
    expect(c.overall).toBe("improvement");
  });

  it("ne compte pas un seuil déjà en échec, ou dont les références divergent", () => {
    expect(compareLoadRuns(record({ thresholds: failing }), record({ thresholds: failing })).thresholds[0].kind).toBe("unchanged");

    const mixed = compareLoadRuns([record({ thresholds: passing }), record({ thresholds: failing })], record({ thresholds: failing }));
    expect(mixed.thresholds[0]).toMatchObject({ baseline: "mixed", kind: "unchanged" });
  });

  it("ignore les seuils quand la charge diffère", () => {
    const c = compareLoadRuns(
      record({ thresholds: passing }),
      record({ thresholds: failing, executor: { type: "constant-vus", vus: 100, durationSeconds: 60 } }),
    );
    expect(c.overall).toBe("inconclusive");
    expect(c.regressions).toEqual([]);
  });
});

describe("capacité observée", () => {
  const objectives = { p95MaxMs: 200 };
  const ramp120 = (knee?: number) =>
    makeRun({ seconds: 120, rps: ramp, p95: knee === undefined ? () => 40 : latencyKnee(knee) }).points;
  const capacity = (c: RunComparison) => metric(c, "capacity.sustainedRps");

  it("détecte une capacité en baisse entre deux rampes", () => {
    // limite à 322 req/s contre 282 req/s
    const c = compareLoadRuns(record({ points: ramp120(70) }), record({ points: ramp120(60) }), { objectives });
    expect(capacity(c)).toMatchObject({ baseline: 322, candidate: 282, change: -40, changePercent: -12.42, verdict: "regression" });
    expect(c.overall).toBe("regression");
    expect(c.regressions.some((r) => r.startsWith("Capacité observée"))).toBe(true);
  });

  it("détecte une capacité en hausse et ignore un écart sous le seuil", () => {
    expect(capacity(compareLoadRuns(record({ points: ramp120(70) }), record({ points: ramp120(80) }), { objectives })).verdict).toBe("improvement");
    expect(capacity(compareLoadRuns(record({ points: ramp120(70) }), record({ points: ramp120(68) }), { objectives })).verdict).toBe("unchanged"); // 314 contre 322
  });

  it("compare la capacité même quand les profils de charge diffèrent", () => {
    const c = compareLoadRuns(
      record({ points: ramp120(70) }),
      record({ points: ramp120(60), executor: { type: "constant-vus", vus: 100, durationSeconds: 60 } }),
      { objectives },
    );
    expect(c.comparability.level).toBe("not-comparable");
    expect(metric(c, "latency.p95").verdict).toBe("unknown");
    expect(capacity(c).verdict).toBe("regression");
    expect(c.overall).toBe("regression");
  });

  it("détecte un candidat qui tient moins que ce que la référence avait déjà prouvé", () => {
    // la référence n'a pas atteint sa limite (au moins 482 req/s) ; le candidat s'arrête à 322
    const c = compareLoadRuns(record({ points: ramp120() }), record({ points: ramp120(70) }), { objectives });
    expect(capacity(c).verdict).toBe("regression");
    expect(capacity(c).note).toContain("déjà prouvé");
  });

  it("détecte un candidat dont les objectifs ne sont plus tenus dès un niveau bas", () => {
    const flat = makeRun({ seconds: 60, rps: () => 250, p95: () => 800 }).points;
    const c = compareLoadRuns(record({ points: ramp120(70) }), record({ points: flat }), { objectives });
    expect(capacity(c).verdict).toBe("regression"); // 250 < 322 × 0,9
  });

  it("reconnaît une amélioration quand le candidat tient bien au-delà de la capacité mesurée avant", () => {
    const c = compareLoadRuns(record({ points: ramp120(70) }), record({ points: ramp120() }), { objectives });
    expect(capacity(c).verdict).toBe("improvement");
  });

  it("reste prudente quand aucun test n'a atteint sa limite", () => {
    const c = compareLoadRuns(record({ points: ramp120() }), record({ points: ramp120() }), { objectives });
    expect(capacity(c).verdict).toBe("unknown");
    expect(capacity(c).note).toContain("aucun des tests");
  });

  it("n'accuse pas une régression pour un candidat borné par un niveau trop proche", () => {
    const flat = makeRun({ seconds: 60, rps: () => 300, p95: () => 800 }).points;
    const c = compareLoadRuns(record({ points: ramp120(70) }), record({ points: flat }), { objectives });
    expect(capacity(c).verdict).toBe("unknown"); // 300 > 322 × 0,9 : on ne peut pas conclure
  });

  it("formate les valeurs de la description", () => {
    const c = compareLoadRuns(record({ points: ramp120(70) }), record({ points: ramp120(60) }), { objectives });
    expect(c.regressions[0]).toBe(`Capacité observée ${"-12,4"} % (322 → 282 req/s)`);
    expect(formatNumber(322, 2)).toBe("322");
  });
});