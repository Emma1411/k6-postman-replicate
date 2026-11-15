import { describe, expect, it } from "vitest";
import { reportFilename, slugify } from "@/shared/reports/files";
import { ReportExportInputSchema } from "@/shared/schemas";
import { REPORT_FORMAT } from "@/shared/reports/model";

describe("slugify / reportFilename", () => {
  it("produit un nom sûr, sans accents ni caractères spéciaux", () => {
    expect(slugify("Rapport de test — Étape 1 / Boutique !")).toBe("rapport-de-test-etape-1-boutique");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("🔥🔥")).toBe("rapport");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });

  it("ajoute la date de génération et l'extension", () => {
    expect(reportFilename({ title: "Rapport", generatedAt: "2026-11-14T10:30:00.000Z" }, "html")).toBe("rapport-202611141030.html");
    expect(reportFilename({ title: "Rapport", generatedAt: "pas une date" }, "json")).toBe("rapport.json");
  });
});

describe("ReportExportInputSchema", () => {
  const valid = {
    format: "html",
    report: {
      format: REPORT_FORMAT,
      version: 1,
      kind: "load",
      title: "T",
      generatedAt: "2026-11-14T10:30:00.000Z",
      sections: [{ title: "S", blocks: [{ type: "text", text: "x" }] }],
    },
  };

  it("accepte un rapport valide, avec ou sans données", () => {
    expect(ReportExportInputSchema.safeParse(valid).success).toBe(true);
    expect(ReportExportInputSchema.safeParse({ ...valid, report: { ...valid.report, data: { a: 1 } } }).success).toBe(true);
  });

  it.each([
    ["format d'export inconnu", { ...valid, format: "pdf" }],
    ["format de rapport inconnu", { ...valid, report: { ...valid.report, format: "autre" } }],
    ["type de rapport inconnu", { ...valid, report: { ...valid.report, kind: "autre" } }],
    ["bloc inconnu", { ...valid, report: { ...valid.report, sections: [{ title: "S", blocks: [{ type: "script", text: "x" }] }] } }],
    ["teinte inconnue", { ...valid, report: { ...valid.report, verdict: { label: "x", tone: "rouge" } } }],
    ["titre vide", { ...valid, report: { ...valid.report, title: "" } }],
  ])("refuse : %s", (_label, input) => {
    expect(ReportExportInputSchema.safeParse(input).success).toBe(false);
  });

  it("borne la taille des graphiques et des tableaux", () => {
    const chart = (points: number) => ({ type: "chart", chart: { title: "t", unit: "", series: [{ label: "s", points: Array.from({ length: points }, (_, i) => ({ x: i, y: i })) }] } });
    const withBlock = (block: unknown) => ({ ...valid, report: { ...valid.report, sections: [{ title: "S", blocks: [block] }] } });
    expect(ReportExportInputSchema.safeParse(withBlock(chart(2000))).success).toBe(true);
    expect(ReportExportInputSchema.safeParse(withBlock(chart(2001))).success).toBe(false);
    expect(ReportExportInputSchema.safeParse(withBlock({ type: "table", columns: Array(31).fill("c"), rows: [] })).success).toBe(false);
  });
});