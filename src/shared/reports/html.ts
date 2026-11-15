import { formatNumber } from "../format";
import { REPORT_FORMAT, formatDateTime, type Block, type ChartSpec, type ReportDocument, type Section, type Tone } from "./model";

/** Échappe tout texte inséré dans le HTML ou dans le SVG. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TONES = new Set<string>(["success", "warning", "danger", "muted"]);
const toneClass = (tone: Tone | undefined): string => (tone && TONES.has(tone) ? ` tone-${tone}` : "");

/** Politique de contenu du fichier : aucun script, aucune ressource externe, seul le style intégré est autorisé. */
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const CSS = `
:root{--bg:#fff;--fg:#1b2430;--muted:#5b6675;--line:#d9dee6;--card:#f6f8fb;--success:#17703a;--warning:#8a5a00;--danger:#b3261e;--c0:#1f5fbf;--c1:#c2410c;--c2:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#0f141b;--fg:#e6ebf2;--muted:#9aa6b6;--line:#2a3441;--card:#161d27;--success:#4ade80;--warning:#fbbf24;--danger:#f87171;--c0:#6ea8fe;--c1:#fb923c;--c2:#2dd4bf}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
header{border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:8px}
h1{font-size:1.6rem;margin:0 0 4px}
h2{font-size:1.2rem;margin:32px 0 10px;border-bottom:1px solid var(--line);padding-bottom:4px}
h3{font-size:1rem;margin:16px 0 6px}
.subtitle,.meta{color:var(--muted);margin:2px 0}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid currentColor;font-weight:600;font-size:.85rem}
.tone-success{color:var(--success)}.tone-warning{color:var(--warning)}.tone-danger{color:var(--danger)}.tone-muted{color:var(--muted)}
.table-wrap{overflow-x:auto;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:.9rem}
caption{text-align:left;color:var(--muted);padding:4px 0}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:var(--card);font-weight:600}
dl.kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin:8px 0}
dl.kv div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
dt{color:var(--muted);font-size:.8rem}
dd{margin:0;font-weight:600;word-break:break-word}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;font-size:.8rem}
figure.chart{margin:12px 0}
figcaption{font-weight:600;margin-bottom:4px}
svg{width:100%;height:auto;max-width:720px}
.axis{stroke:var(--line)}.grid{stroke:var(--line);stroke-dasharray:2 3}
.tick{fill:var(--muted);font-size:11px}
.line{fill:none;stroke-width:2}
.s0{stroke:var(--c0)}.s1{stroke:var(--c1);stroke-dasharray:6 3}.s2{stroke:var(--c2);stroke-dasharray:2 3}
.dot{stroke:none}.dot.s0{fill:var(--c0)}.dot.s1{fill:var(--c1)}.dot.s2{fill:var(--c2)}
.limit{stroke:var(--danger);stroke-dasharray:4 3;stroke-width:1.5}.limit-label{fill:var(--danger);font-size:11px}
.legend{list-style:none;display:flex;gap:16px;flex-wrap:wrap;margin:4px 0;padding:0;font-size:.85rem}
.sw{display:inline-block;width:22px;border-top:3px solid;vertical-align:middle;margin-right:6px}
.sw.s0{border-color:var(--c0)}.sw.s1{border-color:var(--c1);border-top-style:dashed}.sw.s2{border-color:var(--c2);border-top-style:dotted}
footer{margin-top:40px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--line);padding-top:12px}
@media print{body{font-size:12px}main{max-width:none;padding:0}h2{break-after:avoid}table,figure,pre{break-inside:avoid}}
`;

// --- Graphique SVG --------------------------------------------------------------------------------------------------

const W = 720;
const H = 220;
const M = { left: 56, right: 14, top: 14, bottom: 34 };

/** Plus petite « belle » valeur (1, 2, 5 × 10^n) supérieure ou égale à v. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exponent;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exponent;
}

const minOf = (values: number[]): number => values.reduce((a, b) => Math.min(a, b), Infinity);
const maxOf = (values: number[]): number => values.reduce((a, b) => Math.max(a, b), -Infinity);

export function renderChart(spec: ChartSpec): string {
  const caption = `${esc(spec.title)}${spec.unit ? ` (${esc(spec.unit)})` : ""}`;
  const points = spec.series.flatMap((s) => s.points);
  if (points.length === 0) {
    return `<figure class="chart"><figcaption>${caption}</figcaption><p class="tone-muted">Aucune donnée.</p></figure>`;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = minOf(xs);
  const xMax = maxOf(xs) === xMin ? xMin + 1 : maxOf(xs);
  const top = Math.max(maxOf(ys), spec.limit?.y ?? -Infinity);
  const bottom = Math.min(0, minOf(ys));
  const yMax = top <= 0 ? 1 : niceCeil(top);
  const yMin = bottom < 0 ? -niceCeil(-bottom * 1.1) : 0;

  const fx = (v: number) => M.left + ((v - xMin) / (xMax - xMin)) * (W - M.left - M.right);
  const fy = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);
  const c = (v: number) => v.toFixed(1);
  const yDigits = yMax - yMin < 8 ? 1 : 0;

  const parts: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const value = yMin + ((yMax - yMin) * i) / 4;
    const y = c(fy(value));
    parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="tick" x="${M.left - 6}" y="${c(fy(value) + 4)}" text-anchor="end">${esc(formatNumber(value, yDigits))}</text>`);
  }
  for (let i = 0; i <= 4; i++) {
    const value = xMin + ((xMax - xMin) * i) / 4;
    parts.push(`<text class="tick" x="${c(fx(value))}" y="${H - 16}" text-anchor="middle">${esc(formatNumber(value, 0))}</text>`);
  }
  parts.push(`<text class="tick" x="${c((M.left + W - M.right) / 2)}" y="${H - 3}" text-anchor="middle">${esc(spec.xLabel ?? "secondes")}</text>`);
  parts.push(`<line class="axis" x1="${M.left}" x2="${W - M.right}" y1="${c(fy(yMin))}" y2="${c(fy(yMin))}"/>`);

  if (spec.limit) {
    const y = c(fy(spec.limit.y));
    parts.push(`<line class="limit" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="limit-label" x="${W - M.right - 4}" y="${c(fy(spec.limit.y) - 4)}" text-anchor="end">${esc(spec.limit.label)}</text>`);
  }

  spec.series.forEach((s, i) => {
    const cls = `s${i % 3}`;
    if (s.points.length === 1) {
      parts.push(`<circle class="dot ${cls}" cx="${c(fx(s.points[0].x))}" cy="${c(fy(s.points[0].y))}" r="3"/>`);
    } else if (s.points.length > 1) {
      parts.push(`<polyline class="line ${cls}" points="${s.points.map((p) => `${c(fx(p.x))},${c(fy(p.y))}`).join(" ")}"/>`);
    }
  });

  const legend = spec.series.map((s, i) => `<li><span class="sw s${i % 3}"></span>${esc(s.label)}</li>`).join("");
  return (
    `<figure class="chart"><figcaption>${caption}</figcaption>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title)}"><title>${esc(spec.title)}</title>${parts.join("")}</svg>` +
    `<ul class="legend">${legend}</ul></figure>`
  );
}

// --- Blocs et document ----------------------------------------------------------------------------------------------

function renderBlock(block: Block): string {
  switch (block.type) {
    case "text":
      return `<p class="${toneClass(block.tone).trim()}">${esc(block.text)}</p>`;
    case "keyvalues":
      return `<dl class="kv">${block.rows
        .map((r) => `<div><dt>${esc(r.label)}</dt><dd class="${toneClass(r.tone).trim()}">${esc(r.value)}</dd></div>`)
        .join("")}</dl>`;
    case "list":
      return block.items.length === 0 ? "" : `<ul>${block.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
    case "code":
      return `${block.title ? `<h3>${esc(block.title)}</h3>` : ""}<pre>${esc(block.text)}</pre>`;
    case "chart":
      return renderChart(block.chart);
    case "table": {
      const width = block.columns.length;
      const head = `<tr>${block.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
      const body = block.rows
        .map((row) => {
          const cells = Array.from({ length: width }, (_, i) => row[i] ?? { text: "" });
          return `<tr>${cells.map((c) => `<td class="${toneClass(c.tone).trim()}">${esc(c.text)}</td>`).join("")}</tr>`;
        })
        .join("");
      return `<div class="table-wrap"><table>${block.caption ? `<caption>${esc(block.caption)}</caption>` : ""}<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    }
  }
}

const renderSection = (section: Section): string => `<section><h2>${esc(section.title)}</h2>${section.blocks.map(renderBlock).join("")}</section>`;

/** Document HTML autonome : style intégré, graphiques en SVG, aucun script, aucune ressource externe. */
export function renderReportHtml(doc: ReportDocument): string {
  const date = new Date(doc.generatedAt);
  const generated = Number.isNaN(date.getTime()) ? doc.generatedAt : formatDateTime(date);
  const badge = doc.verdict ? ` <span class="badge${toneClass(doc.verdict.tone)}">${esc(doc.verdict.label)}</span>` : "";

  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">` +
    `<meta name="generator" content="API Engineering Platform">` +
    `<title>${esc(doc.title)}</title><style>${CSS}</style></head><body><main>` +
    `<header><h1>${esc(doc.title)}</h1>` +
    `${doc.subtitle ? `<p class="subtitle">${esc(doc.subtitle)}</p>` : ""}` +
    `<p class="meta">Généré le ${esc(generated)}${badge}</p></header>` +
    `${doc.sections.map(renderSection).join("")}` +
    `<footer>Rapport généré par API Engineering Platform · format ${esc(REPORT_FORMAT)} v${doc.version}</footer>` +
    `</main></body></html>`
  );
}