import { describe, expect, it } from "vitest";
import { exportReportController } from "@/server/controllers/reports.controller";
import { buildFunctionalReport } from "@/shared/reports/builders";
import { MASK } from "@/shared/reports/redaction";
import { ReportExportInputSchema } from "@/shared/schemas";
import { meta, workflowResult } from "../../helpers/report-fixtures";

const call = (format: "html" | "json", report: unknown) => exportReportController(ReportExportInputSchema.parse({ format, report }));

describe("exportReportController", () => {
  const report = buildFunctionalReport(workflowResult(), meta);

  it("sert le HTML en téléchargement, avec une politique de contenu stricte", async () => {
    const res = call("html", report);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="rapport-de-test-fonctionnel-boutique-202611141030.html"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");

    const html = await res.text();
    expect(html).toContain("<title>Rapport de test fonctionnel : Boutique</title>");
    expect(html).toContain(MASK);
    expect(html).not.toContain("abc123");
    expect(html).not.toContain("<script");
  });

  it("sert le document JSON tel quel", async () => {
    const res = call("json", report);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain(".json");
    const body = await res.json();
    expect(body.kind).toBe("functional");
    expect(body.sections.length).toBe(report.sections.length);
    expect(JSON.stringify(body)).not.toContain("abc123");
  });

  it("échappe un titre malveillant, y compris dans l'en-tête de nom de fichier", async () => {
    const evil = { ...report, title: '<script>alert(1)</script>"; filename="x.exe' };
    const res = call("html", evil);
    const disposition = res.headers.get("content-disposition") as string;
    expect(disposition).toMatch(/^attachment; filename="[a-z0-9-]+\.html"$/);

    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});