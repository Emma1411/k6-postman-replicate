import type { ReportDocument } from "./model";

export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "rapport";
}

/** Nom de fichier sûr : lettres minuscules, chiffres et tirets seulement, suivi de la date de génération. */
export function reportFilename(report: Pick<ReportDocument, "title" | "generatedAt">, format: "html" | "json"): string {
  const stamp = report.generatedAt.replace(/\D/g, "").slice(0, 12);
  return `${slugify(report.title)}${stamp ? `-${stamp}` : ""}.${format}`;
}