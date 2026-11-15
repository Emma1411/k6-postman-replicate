import { describe, expect, it } from "vitest";
import { analyzeRun } from "@/shared/advisor/analyze";
import { planCapacity } from "@/shared/advisor/capacity/plan";
import { compareLoadRuns } from "@/shared/compare/load";
import { compareWorkflowRuns } from "@/shared/compare/functional";
import {
  buildAdvisorReport,
  buildCapacityReport,
  buildFunctionalReport,
  buildLoadComparisonReport,
  buildLoadReport,
  buildWorkflowComparisonReport,
} from "@/shared/reports/builders";
import { MASK } from "@/shared/reports/redaction";
import type { Block, ReportDocument, Section } from "@/shared/reports/model";
import { latencyKnee, makeRun, ramp } from "../../helpers/advisor-fixtures";
import { record, threshold } from "../../helpers/compare-fixtures";
import { meta, step, workflowResult } from "../../helpers/report-fixtures";
import {
  CapacityInputSchema,
  normalizeAnalyzeInput,
  normalizeCapacityInput,
  ObjectivesSchema,
  PolicySchema,
} from "@/shared/schemas";

const section = (doc: ReportDocument, title: string): Section => {
  const found = doc.sections.find((s) => s.title === title);

  if (!found) {
    throw new Error(
      `Section introuvable : ${title} (${doc.sections.map((s) => s.title).join(", ")})`,
    );
  }

  return found;
};

type TableBlock = Extract<Block, { type: "table" }>;

const table = (s: Section): TableBlock => {
  const found = s.blocks.find((b): b is TableBlock => b.type === "table");

  if (!found) {
    throw new Error(`Aucun tableau dans la section : ${s.title}`);
  }

  return found;
};

const texts = (s: Section) =>
  table(s).rows.map((row) => row.map((c) => c.text));

describe("rapport fonctionnel", () => {
  it("résume le test, ses étapes et ses échecs", () => {
    const doc = buildFunctionalReport(workflowResult(), {
      ...meta,
      environment: "staging",
    });
    expect(doc).toMatchObject({
      kind: "functional",
      title: "Rapport de test fonctionnel : Boutique",
      subtitle: "Environnement : staging",
      generatedAt: "2026-11-14T10:30:00.000Z",
    });
    expect(doc.verdict).toEqual({ label: "En échec", tone: "danger" });

    const rows = table(section(doc, "Étapes")).rows;
    expect(rows[0].map((c) => c.text)).toEqual([
      "Connexion",
      "Réussie",
      "200",
      "42,5",
      "—",
    ]);
    expect(rows[1].map((c) => c.text)).toEqual([
      "Création",
      "Échec",
      "500",
      "30",
      "Statut 201 : Statut attendu 201, reçu 500.",
    ]);
    expect(rows[1][1].tone).toBe("danger");
    expect(rows[2].map((c) => c.text).slice(0, 3)).toEqual([
      "Suppression",
      "Ignorée",
      "—",
    ]);

    const failures = section(doc, "Assertions en échec").blocks[0];
    expect(failures).toEqual({
      type: "list",
      items: ["Création — Statut 201 : Statut attendu 201, reçu 500."],
    });

    const summary = section(doc, "Résumé").blocks[0] as Extract<
      Block,
      { type: "keyvalues" }
    >;
    expect(summary.rows.find((r) => r.label === "Arrêt à l'étape")?.value).toBe(
      "Création",
    );
  });

  it("masque les secrets partout par défaut, y compris dans les données", () => {
    const doc = buildFunctionalReport(workflowResult(), meta);
    const json = JSON.stringify(doc);
    expect(json).not.toContain("abc123");
    expect(json).not.toContain("secretvalue");
    expect(json).not.toContain("zzz");
    expect(json).toContain(`api_key=${MASK}`);
    expect(json).toContain("http://x"); // les valeurs ordinaires restent

    expect(texts(section(doc, "Variables extraites"))).toEqual([
      ["Connexion", "token", MASK],
    ]);
    expect(texts(section(doc, "Variables finales"))).toEqual([
      ["base", "http://x"],
      ["token", MASK],
    ]);
    expect(doc.sections.some((s) => s.title === "Aperçus des réponses")).toBe(
      false,
    );
  });

  it("n'expurge que sur demande explicite, et l'annonce en tête", () => {
    const doc = buildFunctionalReport(workflowResult(), meta, {
      redactSecrets: false,
      includeResponsePreviews: false,
    });
    expect(JSON.stringify(doc)).toContain("abc123");
    const first = section(doc, "Résumé").blocks[0];
    expect(first).toMatchObject({ type: "text", tone: "danger" });
    expect((first as { text: string }).text).toContain("n'est pas expurgé");
  });

  it("inclut des aperçus expurgés à la demande", () => {
    const doc = buildFunctionalReport(workflowResult(), meta, {
      redactSecrets: true,
      includeResponsePreviews: true,
    });
    const preview = section(doc, "Aperçus des réponses").blocks[0] as Extract<
      Block,
      { type: "code" }
    >;
    expect(preview.title).toBe("Connexion");
    expect(preview.text).toBe(`{"token":"${MASK}","ok":true}`);
  });

  it("distingue un test interrompu et un test réussi", () => {
    const ok = {
      ...workflowResult(),
      status: "passed" as const,
      stoppedAtStepId: null,
      steps: [step("a", "A", "passed")],
      variables: {},
    };
    expect(buildFunctionalReport(ok, meta).verdict).toEqual({
      label: "Réussi",
      tone: "success",
    });
    expect(
      buildFunctionalReport({ ...ok, aborted: true }, meta).verdict,
    ).toEqual({ label: "Interrompu", tone: "warning" });
  });

  it("utilise le titre fourni", () => {
    expect(
      buildFunctionalReport(workflowResult(), { ...meta, title: "Recette v2" })
        .title,
    ).toBe("Recette v2");
  });
});

describe("rapport de test de charge", () => {
  const points = makeRun({
    seconds: 120,
    rps: ramp,
    p95: latencyKnee(70),
  }).points;
  const base = record({
    label: "v1.4",
    environment: "staging",
    status: "failed",
    points,
    thresholds: [
      threshold("http_req_duration", "p(95)<500", true),
      threshold("http_req_failed", "rate<0.01", false),
    ],
  });
  base.result.snapshot.statusDistribution = {
    "200": 900,
    "500": 90,
    error: 10,
  };

  it("présente le résumé, la latence, les seuils et les statuts", () => {
    const doc = buildLoadReport(base, { p95MaxMs: 200 }, meta);
    expect(doc.kind).toBe("load");
    expect(doc.verdict).toEqual({
      label: "Seuils non respectés",
      tone: "danger",
    });
    expect(doc.subtitle).toBe("v1.4 · staging");

    expect(texts(section(doc, "Latence")).find((r) => r[0] === "p95")).toEqual([
      "p95",
      "200",
    ]);
    expect(texts(section(doc, "Seuils"))).toEqual([
      ["http_req_duration", "p(95)<500", "1", "Respecté"],
      ["http_req_failed", "rate<0.01", "1", "En échec"],
    ]);
    expect(table(section(doc, "Seuils")).rows[1][3].tone).toBe("danger");
    expect(texts(section(doc, "Statuts HTTP"))).toEqual([
      ["200", "900", "90 %"],
      ["500", "90", "9 %"],
      ["Erreur (pas de réponse)", "10", "1 %"],
    ]);
  });

  it("trace quatre graphiques, avec l'objectif de latence sur le p95", () => {
    const charts = section(
      buildLoadReport(base, { p95MaxMs: 200 }, meta),
      "Évolution",
    ).blocks.map((b) => (b as Extract<Block, { type: "chart" }>).chart);
    expect(charts.map((c) => c.title)).toEqual([
      "Débit",
      "Latence p95",
      "Utilisateurs virtuels",
      "Taux d'erreur",
    ]);
    expect(charts[1].limit).toEqual({ label: "Objectif p95", y: 200 });
    expect(charts[0].series[0].points).toHaveLength(120);
    expect(charts[0].limit).toBeUndefined();
  });

  it("réduit les longues séries et omet les graphiques sans série temporelle", () => {
    const long = Array.from({ length: 1000 }, (_, i) => ({
      ...points[0],
      t: i + 1,
      rps: i,
    }));
    const doc = buildLoadReport({ ...base, points: long }, {}, meta);
    const chart = (
      section(doc, "Évolution").blocks[0] as Extract<Block, { type: "chart" }>
    ).chart;
    expect(chart.series[0].points.length).toBeLessThanOrEqual(240);

    expect(
      buildLoadReport({ ...base, points: undefined }, {}, meta).sections.some(
        (s) => s.title === "Évolution",
      ),
    ).toBe(false);
  });

  it("signale un générateur saturé", () => {
    const doc = buildLoadReport(record({ saturated: true }), {}, meta);
    const blocks = section(doc, "Générateur de charge").blocks;
    expect(
      blocks.some(
        (b) =>
          b.type === "text" &&
          b.tone === "danger" &&
          b.text.includes("peu fiables"),
      ),
    ).toBe(true);
  });

  it("rend le verdict de chaque issue possible", () => {
    const verdict = (status: "passed" | "failed" | "aborted" | "error") =>
      buildLoadReport(record({ status }), {}, meta).verdict;
    expect(verdict("passed")).toEqual({ label: "Réussi", tone: "success" });
    expect(verdict("aborted")).toEqual({
      label: "Interrompu",
      tone: "warning",
    });
    expect(verdict("error")).toEqual({ label: "Erreur", tone: "danger" });
  });

  it("intègre l'analyse de l'Advisor et la comparaison quand on les fournit", () => {
    const analysis = analyzeRun(
      normalizeAnalyzeInput({
        run: makeRun({ seconds: 60, rps: () => 100, p95: () => 50 }),
      }),
    );
    const comparison = compareLoadRuns(
      record({ p95: 200 }),
      record({ p95: 260 }),
    );
    const doc = buildLoadReport(base, { analysis, comparison }, meta);
    const titles = doc.sections.map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Constats",
        "Recommandations",
        "Synthèse de la comparaison",
        "Métriques",
      ]),
    );
    expect(doc.data).toMatchObject({
      analysis: { advisoryOnly: true },
      comparison: { overall: "regression" },
    });
  });
});

describe("rapport de l'Advisor", () => {
  const analysis = analyzeRun(
    normalizeAnalyzeInput({
      run: makeRun({
        seconds: 120,
        rps: ramp,
        p95: latencyKnee(70),
        cpu: (t) => Math.min(100, ramp(t) / 4.5),
      }),
      objectives: ObjectivesSchema.parse({
        p95MaxMs: 200,
        targetRps: 400,
      }),
      policy: PolicySchema.parse({
        sustainSeconds: 20,
      }),
    }),
  );
  const doc = buildAdvisorReport(analysis, meta);

  it("liste les constats par gravité, les recommandations et la qualité des données", () => {
    expect(doc.kind).toBe("advisor");
    expect(doc.sections.map((s) => s.title)).toEqual([
      "Résumé du test analysé",
      "Capacité observée",
      "Constats",
      "Recommandations",
      "Qualité des données",
    ]);
    expect(doc.verdict).toEqual({
      label: "Problèmes critiques",
      tone: "danger",
    });

    const findings = texts(section(doc, "Constats"));
    expect(findings[0][0]).toBe("Critique");
    expect(
      findings.some(
        (r) => r[1] === "Limite CPU probable" && r[3].includes("CPU"),
      ),
    ).toBe(true);
    expect(
      texts(section(doc, "Recommandations")).some((r) => r[1] === "Scale out"),
    ).toBe(true);
    expect(
      section(doc, "Capacité observée").blocks.some((b) => b.type === "table"),
    ).toBe(false); // pas de tableau : des paires clé / valeur
  });

  it("rappelle que les résultats sont consultatifs", () => {
    const blocks = section(doc, "Recommandations").blocks;
    expect(
      blocks.some((b) => b.type === "text" && b.text.includes("consultatifs")),
    ).toBe(true);
  });

  it("annonce l'absence de problème quand il n'y a aucun constat", () => {
    const clean = { ...analysis, findings: [] };
    const report = buildAdvisorReport(clean, meta);
    expect(report.verdict?.tone).toBe("success");
    expect(section(report, "Constats").blocks[0]).toMatchObject({
      type: "text",
      tone: "success",
    });
  });
});

describe("rapport de capacity planning", () => {
  const input = {
    mode: "predictive",
    service: { cpuMsPerRequest: 10, baselineP95Ms: 80 },
    objectives: { targetRps: 400, p95MaxMs: 300, headroomPercent: 30 },
    configs: [
      {
        name: "Architecture A",
        instances: 1,
        vcpuPerInstance: 2,
        ramGbPerInstance: 4,
      },
      {
        name: "Architecture B",
        instances: 2,
        vcpuPerInstance: 2,
        ramGbPerInstance: 4,
      },
      {
        name: "Architecture C",
        instances: 2,
        vcpuPerInstance: 4,
        ramGbPerInstance: 8,
      },
    ],
  };
  const capacity = planCapacity(
    normalizeCapacityInput(CapacityInputSchema.parse(input)),
  );

  it("compare les architectures avec leur verdict, leur fourchette et leurs hypothèses", () => {
    const doc = buildCapacityReport(capacity, meta);
    expect(doc.kind).toBe("capacity");
    expect(doc.sections.map((s) => s.title)).toEqual([
      "Objectif",
      "Modèle et hypothèses",
      "Scénarios",
      "Contrôles par scénario",
      "Choix",
      "Dimensionnement",
      "Test de vérification proposé",
      "À retenir",
    ]);

    const scenarios = table(section(doc, "Scénarios"));
    expect(scenarios.rows.map((r) => r[0].text)).toEqual([
      "Architecture A",
      "Architecture B",
      "Architecture C",
    ]);
    expect(scenarios.rows.map((r) => [r[4].text, r[4].tone])).toEqual([
      ["Insuffisante", "danger"],
      ["Insuffisante", "danger"],
      ["Marginal", "warning"],
    ]);
    expect(scenarios.rows[2][2].text).toMatch(/^571 \(420–.+\)$/);
    expect(scenarios.rows[2][2].text.startsWith("571 (420–")).toBe(true);

    const assumptions = texts(section(doc, "Modèle et hypothèses"));
    expect(assumptions.find((r) => r[0] === "Coût CPU par requête")?.[2]).toBe(
      "Saisie",
    );
    expect(
      assumptions.find((r) => r[0] === "Variabilité du temps de service")?.[2],
    ).toBe("Par défaut");

    expect(doc.verdict).toEqual({
      label: "Configuration retenue (à valider) : Architecture C",
      tone: "warning",
    });
  });

  it("explique le choix, le dimensionnement et le plan de vérification", () => {
    const doc = buildCapacityReport(capacity, meta);
    const choice = section(doc, "Choix").blocks[0] as Extract<
      Block,
      { type: "text" }
    >;
    expect(choice.text).toContain("estimation centrale");
    const sizing = section(doc, "Dimensionnement").blocks[1] as Extract<
      Block,
      { type: "keyvalues" }
    >;
    expect(
      sizing.rows.find((r) => r.label.startsWith("Instances recommandées"))
        ?.value,
    ).toBe("8");
    const verification = section(doc, "Test de vérification proposé")
      .blocks[0] as Extract<Block, { type: "keyvalues" }>;
    expect(verification.rows[0].value).toBe("ramping-arrival-rate");
  });

  it("signale un plan de vérification qui dépasse les limites du serveur", () => {
    const withLimits = {
      ...capacity,
      verification: {
        ...capacity.verification,
        withinServerLimits: {
          ok: false,
          violations: ["Débit : 520 req/s > 500 req/s"],
        },
      },
    };
    const blocks = section(
      buildCapacityReport(withLimits, meta),
      "Test de vérification proposé",
    ).blocks;
    expect(
      blocks.some(
        (b) =>
          b.type === "text" &&
          b.tone === "danger" &&
          b.text.includes("520 req/s > 500 req/s"),
      ),
    ).toBe(true);
  });

  it("annonce qu'aucune configuration ne convient", () => {
    const none = planCapacity(
      normalizeCapacityInput(
        CapacityInputSchema.parse({
          ...input,
          objectives: { targetRps: 5000, p95MaxMs: 300 },
        }),
      ),
    );
    expect(buildCapacityReport(none, meta).verdict).toEqual({
      label: "Aucune configuration ne convient",
      tone: "danger",
    });
  });
});

describe("rapports de comparaison", () => {
  it("décrit une comparaison de tests de charge", () => {
    const doc = buildLoadComparisonReport(
      compareLoadRuns(
        record({ label: "v1", p95: 200 }),
        record({ label: "v2", p95: 260 }),
      ),
      meta,
    );
    expect(doc.kind).toBe("load-comparison");
    expect(doc.title).toBe("Comparaison de tests de charge : v2");
    expect(doc.verdict).toEqual({ label: "Régression", tone: "danger" });

    const p95 = texts(section(doc, "Métriques")).find(
      (r) => r[0] === "Latence p95",
    );
    expect(p95).toEqual([
      "Latence p95",
      "200 ms",
      "—",
      "260 ms",
      "+60 ms",
      "+30 %",
      "Régression",
    ]);
    expect(
      table(section(doc, "Métriques")).rows.find(
        (r) => r[0].text === "Latence p95",
      )?.[6].tone,
    ).toBe("danger");
  });

  it("signale une comparaison non concluante", () => {
    const c = compareLoadRuns(
      record(),
      record({
        executor: { type: "constant-vus", vus: 100, durationSeconds: 60 },
      }),
    );
    const doc = buildLoadComparisonReport(c, meta);
    expect(doc.verdict).toEqual({ label: "Non concluant", tone: "warning" });
    const synthese = section(doc, "Synthèse de la comparaison").blocks;
    expect(
      synthese.some(
        (b) => b.type === "list" && b.items[0].includes("Charge différente"),
      ),
    ).toBe(true);
  });

  it("décrit une comparaison de tests fonctionnels", () => {
    const base = {
      ...workflowResult(),
      status: "passed" as const,
      steps: [step("create", "Création", "passed")],
      variables: {},
    };
    const cand = {
      ...base,
      status: "failed" as const,
      steps: [step("create", "Création", "failed")],
    };
    const doc = buildWorkflowComparisonReport(
      compareWorkflowRuns(base, cand),
      meta,
    );
    expect(doc.kind).toBe("functional-comparison");
    expect(doc.verdict).toEqual({ label: "Régression", tone: "danger" });
    const row = texts(section(doc, "Étapes modifiées"))[0];
    expect(row.slice(0, 4)).toEqual([
      "Création",
      "passed",
      "failed",
      "Nouvel échec",
    ]);
  });
});
