import "server-only";
import { reportFilename } from "@/shared/reports/files";
import { renderReportHtml, REPORT_CSP } from "@/shared/reports/html";
import type { ReportDocument } from "@/shared/reports/model";
import type { ReportExportInput } from "@/shared/schemas";

/** Valide puis rend un rapport. Le fichier est servi en téléchargement, sans interprétation par le navigateur. */
export function exportReportController(input: ReportExportInput): Response {
  const report = input.report as ReportDocument;
  const common = {
    "Content-Disposition": `attachment; filename="${reportFilename(report, input.format)}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };

  if (input.format === "json") {
    return new Response(JSON.stringify(report, null, 2), {
      headers: { ...common, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(renderReportHtml(report), {
    headers: {
      ...common,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `${REPORT_CSP}; sandbox`,
    },
  });
}