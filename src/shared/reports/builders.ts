import type { LoadPoint } from "@/shared/schemas";
import type { AnalyzeResult } from "@/shared/types/advisor-result";
import type { CapacityResult } from "@/shared/types/capacity-result";
import type { LoadRunRecord, RunComparison, WorkflowComparison } from "@/shared/types/comparison-result";
import type { LoadRunResult } from "@/shared/types/load-result";
import type { WorkflowRunResult } from "@/shared/types/workflow-result";
import { loadSignature } from "../compare/load";
import { formatNumber } from "../format";
import {
  cell,
  DEFAULT_REPORT_OPTIONS,
  formatDateTime,
  kv,
  REPORT_FORMAT,
  truncate,
  type Block,
  type ChartPoint,
  type ChartSpec,
  type ReportDocument,
  type ReportKind,
  type ReportMeta,
  type ReportOptions,
  type Section,
  type Tone,
} from "./model";
import { redactWorkflowResult } from "./redaction";
import { advisorSections, capacitySections, loadComparisonSections, workflowComparisonSections } from "./sections";

function document(
  kind: ReportKind,
  meta: ReportMeta,
  title: string,
  sections: Section[],
  data: unknown,
  verdict?: { label: string; tone: Tone },
  subtitle?: string,
): ReportDocument {
  const doc: ReportDocument = {
    format: REPORT_FORMAT,
    version: 1,
    kind,
    title: meta.title ?? title,
    generatedAt: meta.now.toISOString(),
    sections,
    data,
  };
  if (subtitle) doc.subtitle = subtitle;
  if (verdict) doc.verdict = verdict;
  return doc;
}

const environmentLine = (meta: ReportMeta): string | undefined => (meta.environment ? `Environnement : ${meta.environment}` : undefined);

const unredactedNotice = (options: ReportOptions): Block[] =>
  options.redactSecrets ? [] : [{ type: "text", text: "Ce rapport n'est pas expurgé : il peut contenir des jetons, mots de passe ou autres secrets. Ne le partage pas tel quel.", tone: "danger" }];

// --- Test fonctionnel -----------------------------------------------------------------------------------------------

const STEP_LABEL = { passed: "Réussie", failed: "Échec", error: "Erreur", skipped: "Ignorée" } as const;
const STEP_TONE: Record<keyof typeof STEP_LABEL, Tone> = { passed: "success", failed: "danger", error: "danger", skipped: "muted" };

export function buildFunctionalReport(
  input: WorkflowRunResult,
  meta: ReportMeta,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): ReportDocument {
  const result = options.redactSecrets ? redactWorkflowResult(input, options.includeResponsePreviews) : input;
  const s = result.summary;
  const stoppedAt = result.steps.find((step) => step.stepId === result.stoppedAtStepId);

  const sections: Section[] = [
    {
      title: "Résumé",
      blocks: [
        ...unredactedNotice(options),
        {
          type: "keyvalues",
          rows: [
            kv("Résultat", result.aborted ? "Interrompu" : result.status === "passed" ? "Réussi" : "En échec", result.status === "passed" && !result.aborted ? "success" : "danger"),
            kv("Durée", `${formatNumber(result.durationMs, 0)} ms`),
            kv("Étapes", String(s.steps)),
            kv("Réussies", String(s.passed)),
            kv("En échec", String(s.failed), s.failed > 0 ? "danger" : undefined),
            kv("En erreur", String(s.errors), s.errors > 0 ? "danger" : undefined),
            kv("Ignorées", String(s.skipped)),
            kv("Assertions réussies", String(s.assertionsPassed)),
            kv("Assertions en échec", String(s.assertionsFailed), s.assertionsFailed > 0 ? "danger" : undefined),
            ...(result.stoppedAtStepId ? [kv("Arrêt à l'étape", stoppedAt?.name ?? result.stoppedAtStepId, "warning" as const)] : []),
          ],
        },
      ],
    },
    {
      title: "Étapes",
      blocks: [
        {
          type: "table",
          columns: ["Étape", "Statut", "HTTP", "Durée (ms)", "Détails"],
          rows: result.steps.map((step) => {
            const details = [
              ...step.assertions.filter((a) => !a.passed).map((a) => `${a.label}${a.message ? ` : ${a.message}` : ""}`),
              ...step.extractionErrors,
              ...(step.error ? [`${step.error.code} : ${step.error.message}`] : []),
              ...(step.skippedReason ? [step.skippedReason] : []),
            ];
            return [
              cell(step.name),
              cell(STEP_LABEL[step.status], STEP_TONE[step.status]),
              cell(step.response ? String(step.response.status) : "—"),
              cell(step.response ? formatNumber(step.response.durationMs, 1) : "—"),
              cell(details.length > 0 ? truncate(details.join(" ; "), 500) : "—"),
            ];
          }),
        },
      ],
    },
  ];

  const failures = result.steps.flatMap((step) =>
    step.assertions.filter((a) => !a.passed).map((a) => `${step.name} — ${a.label}${a.message ? ` : ${a.message}` : ""}`),
  );
  if (failures.length > 0) sections.push({ title: "Assertions en échec", blocks: [{ type: "list", items: failures }] });

  const extracted = result.steps.flatMap((step) =>
    Object.entries(step.extracted).map(([key, value]) => [cell(step.name), cell(key), cell(truncate(value, 120))]),
  );
  if (extracted.length > 0) {
    sections.push({ title: "Variables extraites", blocks: [{ type: "table", columns: ["Étape", "Variable", "Valeur"], rows: extracted }] });
  }

  const variables = Object.entries(result.variables).sort(([a], [b]) => a.localeCompare(b));
  if (variables.length > 0) {
    sections.push({
      title: "Variables finales",
      blocks: [{ type: "table", columns: ["Nom", "Valeur"], rows: variables.map(([key, value]) => [cell(key), cell(truncate(value, 120))]) }],
    });
  }

  if (options.includeResponsePreviews) {
    const previews = result.steps.filter((step) => step.response?.preview);
    if (previews.length > 0) {
      sections.push({
        title: "Aperçus des réponses",
        blocks: previews.map((step): Block => ({ type: "code", title: step.name, text: step.response?.preview ?? "" })),
      });
    }
  }

  const verdict = result.aborted
    ? { label: "Interrompu", tone: "warning" as const }
    : result.status === "passed"
      ? { label: "Réussi", tone: "success" as const }
      : { label: "En échec", tone: "danger" as const };

  return document("functional", meta, `Rapport de test fonctionnel : ${result.workflow}`, sections, { result }, verdict, environmentLine(meta));
}

// --- Test de charge -------------------------------------------------------------------------------------------------

export interface LoadReportExtras {
  analysis?: AnalyzeResult;
  comparison?: RunComparison;
  /** Objectif de latence, tracé comme ligne de référence sur le graphique du p95. */
  p95MaxMs?: number;
}

/** Réduit une série à `max` points en moyennant des paquets consécutifs. */
function downsample(points: ChartPoint[], max = 240): ChartPoint[] {
  if (points.length <= max) return points;
  const size = Math.ceil(points.length / max);
  const out: ChartPoint[] = [];
  for (let i = 0; i < points.length; i += size) {
    const bucket = points.slice(i, i + size);
    out.push({
      x: bucket.reduce((sum, p) => sum + p.x, 0) / bucket.length,
      y: bucket.reduce((sum, p) => sum + p.y, 0) / bucket.length,
    });
  }
  return out;
}

function loadCharts(points: LoadPoint[], p95MaxMs: number | undefined): ChartSpec[] {
  const series = (pick: (p: LoadPoint) => number | null): ChartPoint[] =>
    downsample(points.flatMap((p) => {
      const y = pick(p);
      return y === null ? [] : [{ x: p.t, y }];
    }));

  const p95Chart: ChartSpec = {
    title: "Latence p95",
    unit: "ms",
    series: [{ label: "p95", points: series((p) => (p.duration ? p.duration.p95 : null)) }],
  };
  if (p95MaxMs !== undefined) p95Chart.limit = { label: "Objectif p95", y: p95MaxMs };

  return [
    { title: "Débit", unit: "req/s", series: [{ label: "Requêtes par seconde", points: series((p) => p.rps) }] },
    p95Chart,
    { title: "Utilisateurs virtuels", unit: "VUs", series: [{ label: "VUs actifs", points: series((p) => p.vus) }] },
    { title: "Taux d'erreur", unit: "%", series: [{ label: "Erreurs", points: series((p) => (p.requests > 0 ? (p.failed / p.requests) * 100 : 0)) }] },
  ];
}

const RUN_VERDICT: Record<LoadRunResult["status"], { label: string; tone: Tone }> = {
  passed: { label: "Réussi", tone: "success" },
  failed: { label: "Seuils non respectés", tone: "danger" },
  aborted: { label: "Interrompu", tone: "warning" },
  error: { label: "Erreur", tone: "danger" },
};

function statusRows(distribution: Record<string, number>) {
  const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);
  return Object.entries(distribution)
    .sort(([, a], [, b]) => b - a)
    .map(([code, count]) => {
      const tone: Tone | undefined = code === "error" || code.startsWith("5") ? "danger" : code.startsWith("4") ? "warning" : undefined;
      return [
        cell(code === "error" ? "Erreur (pas de réponse)" : code, tone),
        cell(formatNumber(count, 0)),
        cell(`${formatNumber(total > 0 ? (count / total) * 100 : 0, 1)} %`),
      ];
    });
}

export function buildLoadReport(
  record: LoadRunRecord,
  extras: LoadReportExtras,
  meta: ReportMeta,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): ReportDocument {
  const r = record.result;
  const snap = r.snapshot;
  const latency = snap.http_req_duration;

  const sections: Section[] = [
    {
      title: "Résumé",
      blocks: [
        ...unredactedNotice(options),
        {
          type: "keyvalues",
          rows: [
            kv("Scénario", r.name),
            kv("Test", record.label),
            ...(record.environment ? [kv("Environnement", record.environment)] : []),
            kv("Charge", loadSignature(record.executor)),
            kv("Durée", `${formatNumber(r.durationSeconds, 1)} s`),
            kv("Requêtes", formatNumber(snap.http_reqs.count, 0)),
            kv("Débit moyen", `${formatNumber(snap.http_reqs.rate, 1)} req/s`),
            kv("Latence p95", latency ? `${formatNumber(latency.p95, 1)} ms` : "—"),
            kv("Taux d'erreur", snap.http_req_failed.rate === null ? "—" : `${formatNumber(snap.http_req_failed.rate * 100, 2)} %`, snap.http_req_failed.rate && snap.http_req_failed.rate > 0 ? "warning" : undefined),
            kv("Itérations", formatNumber(snap.iterations.count, 0)),
            kv("Itérations abandonnées", formatNumber(snap.dropped_iterations.count, 0), snap.dropped_iterations.count > 0 ? "warning" : undefined),
            kv("Assertions réussies", snap.checks.rate === null ? "—" : `${formatNumber(snap.checks.rate * 100, 2)} %`),
            kv("VUs maximum", formatNumber(snap.vus.max, 0)),
          ],
        },
        ...(r.abortReason ? [{ type: "text" as const, text: `Interrompu : ${r.abortReason}`, tone: "warning" as const }] : []),
        ...(r.error ? [{ type: "text" as const, text: `Erreur : ${r.error}`, tone: "danger" as const }] : []),
      ],
    },
  ];

  if (latency) {
    sections.push({
      title: "Latence",
      blocks: [
        {
          type: "table",
          columns: ["Indicateur", "Valeur (ms)"],
          rows: [
            ["Moyenne", latency.avg],
            ["Minimum", latency.min],
            ["Médiane (p50)", latency.med],
            ["p90", latency.p90],
            ["p95", latency.p95],
            ["p99", latency.p99],
            ["Maximum", latency.max],
          ].map(([label, value]) => [cell(String(label)), cell(formatNumber(value as number, 1))]),
        },
      ],
    });
  }

  sections.push({
    title: "Seuils",
    blocks:
      r.thresholds.length === 0
        ? [{ type: "text", text: "Aucun seuil défini pour ce test.", tone: "muted" }]
        : [
            {
              type: "table",
              columns: ["Métrique", "Expression", "Valeur", "Résultat"],
              rows: r.thresholds.map((t) => [
                cell(t.metric),
                cell(t.expression),
                cell(t.value === null ? "aucune donnée" : formatNumber(t.value, 2)),
                cell(t.passed ? "Respecté" : "En échec", t.passed ? "success" : "danger"),
              ]),
            },
          ],
  });

  if (Object.keys(snap.statusDistribution).length > 0) {
    sections.push({
      title: "Statuts HTTP",
      blocks: [{ type: "table", columns: ["Statut", "Requêtes", "Part"], rows: statusRows(snap.statusDistribution) }],
    });
  }

  sections.push({
    title: "Générateur de charge",
    blocks: [
      {
        type: "keyvalues",
        rows: [
          kv("Workers", String(r.generator.workers)),
          kv("Saturé", r.generator.saturated ? "Oui" : "Non", r.generator.saturated ? "danger" : "success"),
          kv("Fenêtres saturées", String(r.generator.saturatedWindows)),
          kv("Retard maximal de la boucle d'événements", `${formatNumber(r.generator.maxLoopDelayMs, 1)} ms`),
        ],
      },
      ...(r.generator.saturated
        ? [{ type: "text" as const, text: "Le générateur a manqué de ressources : les latences mesurées incluent son propre retard et sont peu fiables.", tone: "danger" as const }]
        : []),
    ],
  });

  if (record.points && record.points.length > 1) {
    sections.push({
      title: "Évolution",
      blocks: loadCharts(record.points, extras.p95MaxMs).map((chart): Block => ({ type: "chart", chart })),
    });
  }
  if (extras.analysis) sections.push(...advisorSections(extras.analysis));
  if (extras.comparison) sections.push(...loadComparisonSections(extras.comparison));

  const subtitle = [record.label, record.environment ?? meta.environment, record.startedAt ? formatDateTime(new Date(record.startedAt)) : undefined]
    .filter(Boolean)
    .join(" · ");

  return document(
    "load",
    meta,
    `Rapport de test de charge : ${r.name}`,
    sections,
    { record, analysis: extras.analysis ?? null, comparison: extras.comparison ?? null },
    RUN_VERDICT[r.status],
    subtitle,
  );
}

// --- Advisor, capacity planning, comparaisons ------------------------------------------------------------------------

export function buildAdvisorReport(analysis: AnalyzeResult, meta: ReportMeta): ReportDocument {
  const worst = analysis.findings.some((f) => f.severity === "critical")
    ? { label: "Problèmes critiques", tone: "danger" as const }
    : analysis.findings.some((f) => f.severity === "warning")
      ? { label: "Points d'attention", tone: "warning" as const }
      : { label: "Aucun problème détecté", tone: "success" as const };

  return document("advisor", meta, "Rapport d'analyse de scalabilité", advisorSections(analysis), { analysis }, worst, environmentLine(meta));
}

export function buildCapacityReport(capacity: CapacityResult, meta: ReportMeta): ReportDocument {
  const best = capacity.best ? capacity.scenarios[capacity.best.index] : undefined;
  const verdict = best
    ? best.verdict === "ok"
      ? { label: `Configuration retenue : ${best.name}`, tone: "success" as const }
      : { label: `Configuration retenue (à valider) : ${best.name}`, tone: "warning" as const }
    : { label: "Aucune configuration ne convient", tone: "danger" as const };

  return document("capacity", meta, "Rapport de capacity planning", capacitySections(capacity), { capacity }, verdict, environmentLine(meta));
}

const COMPARISON_VERDICT: Record<RunComparison["overall"], { label: string; tone: Tone }> = {
  regression: { label: "Régression", tone: "danger" },
  improvement: { label: "Amélioration", tone: "success" },
  "no-change": { label: "Aucun écart significatif", tone: "success" },
  inconclusive: { label: "Non concluant", tone: "warning" },
};

export function buildLoadComparisonReport(comparison: RunComparison, meta: ReportMeta): ReportDocument {
  return document(
    "load-comparison",
    meta,
    `Comparaison de tests de charge : ${comparison.candidate.label}`,
    loadComparisonSections(comparison),
    { comparison },
    COMPARISON_VERDICT[comparison.overall],
    environmentLine(meta),
  );
}

export function buildWorkflowComparisonReport(comparison: WorkflowComparison, meta: ReportMeta): ReportDocument {
  const verdict = {
    regression: { label: "Régression", tone: "danger" as const },
    improvement: { label: "Amélioration", tone: "success" as const },
    "no-change": { label: "Aucun changement", tone: "success" as const },
  }[comparison.overall];

  return document("functional-comparison", meta, "Comparaison de tests fonctionnels", workflowComparisonSections(comparison), { comparison }, verdict, environmentLine(meta));
}