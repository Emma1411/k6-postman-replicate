import { describe, expect, it } from "vitest";
import { esc, renderChart, renderReportHtml, REPORT_CSP } from "@/shared/reports/html";
import { REPORT_FORMAT, type ReportDocument } from "@/shared/reports/model";

const doc = (over: Partial<ReportDocument> = {}): ReportDocument => ({
  format: REPORT_FORMAT,
  version: 1,
  kind: "load",
  title: "Titre",
  generatedAt: "2026-11-14T10:30:00.000Z",
  sections: [],
  data: {},
  ...over,
});

describe("esc", () => {
  it("échappe les cinq caractères dangereux, & en premier", () => {
    expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
});

describe("renderReportHtml : sécurité", () => {
  it("interdit tout script et toute ressource externe", () => {
    const html = renderReportHtml(doc({ sections: [{ title: "S", blocks: [{ type: "text", text: "x" }] }] }));
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`);
    expect(REPORT_CSP).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/src="http/i);
  });

  it("échappe tous les textes issus des données : titre, sections, cellules, listes, code", () => {
    const evil = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;
    const html = renderReportHtml(
      doc({
        title: evil,
        subtitle: evil,
        verdict: { label: evil, tone: "danger" },
        sections: [
          {
            title: evil,
            blocks: [
              { type: "text", text: evil },
              { type: "keyvalues", rows: [{ label: evil, value: evil }] },
              { type: "table", columns: [evil], rows: [[{ text: evil }]] },
              { type: "list", items: [evil] },
              { type: "code", title: evil, text: evil },
              { type: "chart", chart: { title: evil, unit: evil, series: [{ label: evil, points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }], limit: { label: evil, y: 2 } } },
            ],
          },
        ],
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("ignore une teinte inconnue plutôt que de l'insérer dans le HTML", () => {
    const html = renderReportHtml(doc({ verdict: { label: "x", tone: 'danger" onload="alert(1)' as never } }));
    expect(html).not.toContain("onload");
  });
});

describe("renderReportHtml : contenu", () => {
  it("rend l'en-tête, le verdict, les sections et le pied de page", () => {
    const html = renderReportHtml(
      doc({
        subtitle: "staging",
        verdict: { label: "Réussi", tone: "success" },
        sections: [
          {
            title: "Résumé",
            blocks: [
              { type: "keyvalues", rows: [{ label: "Requêtes", value: "1 000", tone: "warning" }] },
              { type: "table", caption: "Légende", columns: ["A", "B"], rows: [[{ text: "1", tone: "danger" }]] },
              { type: "list", items: ["un", "deux"] },
              { type: "code", title: "Aperçu", text: '{"a":1}' },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<title>Titre</title>");
    expect(html).toContain("Généré le 2026-11-14 10:30 UTC");
    expect(html).toContain('<span class="badge tone-success">Réussi</span>');
    expect(html).toContain("<h2>Résumé</h2>");
    expect(html).toContain('<dd class="tone-warning">1 000</dd>');
    expect(html).toContain("<caption>Légende</caption>");
    expect(html).toContain('<td class="tone-danger">1</td>');
    expect(html).toContain("<li>deux</li>");
    expect(html).toContain("<h3>Aperçu</h3><pre>{&quot;a&quot;:1}</pre>");
    expect(html).toContain(`format ${REPORT_FORMAT} v1`);
  });

  it("complète les lignes de tableau trop courtes", () => {
    const html = renderReportHtml(doc({ sections: [{ title: "S", blocks: [{ type: "table", columns: ["A", "B", "C"], rows: [[{ text: "1" }]] }] }] }));
    expect(html.match(/<td/g)).toHaveLength(3);
  });

  it("garde une date invalide telle quelle au lieu d'échouer", () => {
    expect(renderReportHtml(doc({ generatedAt: "pas une date" }))).toContain("Généré le pas une date");
  });
});

describe("renderChart", () => {
  const spec = {
    title: "Débit",
    unit: "req/s",
    series: [
      { label: "A", points: [{ x: 0, y: 100 }, { x: 60, y: 300 }] },
      { label: "B", points: [{ x: 0, y: 50 }, { x: 60, y: 200 }] },
    ],
    limit: { label: "Objectif", y: 500 },
  };

  it("trace une courbe par série, la légende, la ligne d'objectif et des axes lisibles", () => {
    const svg = renderChart(spec);
    expect(svg.match(/<polyline/g)).toHaveLength(2);
    expect(svg).toContain('<li><span class="sw s0"></span>A</li>');
    expect(svg).toContain('<li><span class="sw s1"></span>B</li>');
    expect(svg).toContain('class="limit"');
    expect(svg).toContain(">Objectif<");
    expect(svg).toContain(">500<"); // le maximum de l'axe englobe l'objectif
    expect(svg).toContain(">125<");
    expect(svg).toContain(">60<");
    expect(svg).toContain("Débit (req/s)");
    expect(svg).toContain('role="img"');
  });

  it("dessine un point isolé et gère un axe des x sans étendue", () => {
    const svg = renderChart({ title: "t", unit: "", series: [{ label: "A", points: [{ x: 5, y: 7 }] }] });
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  it("gère des valeurs négatives et nulles", () => {
    const svg = renderChart({ title: "t", unit: "", series: [{ label: "A", points: [{ x: 0, y: -5 }, { x: 1, y: 0 }] }] });
    expect(svg).not.toContain("NaN");
    expect(svg).toContain(">-10<"); // axe étendu à une belle valeur négative
  });

  it("indique l'absence de données", () => {
    expect(renderChart({ title: "t", unit: "ms", series: [{ label: "A", points: [] }] })).toContain("Aucune donnée");
    expect(renderChart({ title: "t", unit: "ms", series: [] })).toContain("Aucune donnée");
  });

  it("ne dépasse pas trois styles de courbes (couleur et trait)", () => {
    const series = Array.from({ length: 4 }, (_, i) => ({ label: `S${i}`, points: [{ x: 0, y: i }, { x: 1, y: i + 1 }] }));
    const svg = renderChart({ title: "t", unit: "", series });
    expect(svg).toContain('class="line s0"');
    expect(svg).toContain('class="line s2"');
    expect(svg.match(/class="line s0"/g)).toHaveLength(2); // la 4e série reprend le style de la 1re
  });
});