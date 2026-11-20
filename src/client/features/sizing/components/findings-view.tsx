"use client";

import { Info } from "lucide-react";
import { Explain } from "@/client/components/explain";
import { Badge } from "@/client/components/ui/badge";
import { buildHeadline, objectivesFromThresholds } from "@/client/features/load/verdict";
import { formatInt, formatMs } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import type { StoredLoadResult } from "@/client/storage/db";
import type { AnalyzeResult, Finding, Recommendation, RecommendationKind } from "@/shared/types/advisor-result";
import { confidenceLabel, countBySeverity, provenanceOf, severityLabel, sortFindings } from "../analysis";

const BORDER = { critical: "border-l-destructive", warning: "border-l-warning", info: "border-l-primary" } as const;
const SEVERITY_TEXT = { critical: "text-destructive-text", warning: "text-warning", info: "text-primary" } as const;

const KIND_LABELS: Record<RecommendationKind, string> = {
  "scale-up": "Augmenter la taille des instances",
  "scale-out": "Ajouter des instances",
  tune: "Régler",
  investigate: "Investiguer",
  verify: "Vérifier",
};

function FindingCard({ finding }: { finding: Finding }) {
  const provenance = provenanceOf(finding.dataSource);
  return (
    <article className={cn("space-y-3 rounded-xl border border-l-4 border-border bg-card p-5", BORDER[finding.severity])}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">{finding.code}</Badge>
        <span className={cn("font-medium", SEVERITY_TEXT[finding.severity])}>Gravité : {severityLabel(finding.severity)}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          Confiance : {confidenceLabel(finding.confidence)}
          <Explain term="confidence" />
        </span>
        {provenance && <Badge variant="secondary" className="ml-auto font-mono text-[10px] uppercase">{provenance.label}</Badge>}
      </div>
      <h3 className="text-lg font-semibold leading-snug">{finding.title}</h3>
      <p className="text-sm text-muted-foreground">{finding.summary}</p>

      {finding.indicators.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {finding.indicators.map((indicator) => (
            <li key={indicator} className="rounded-md border border-border bg-background/40 px-2.5 py-1 text-xs">
              {indicator}
            </li>
          ))}
        </ul>
      )}

      {finding.evidence.length > 0 && (
        <div className="rounded-lg bg-background/60 p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Preuves chiffrées</p>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {finding.evidence.map((e) => (
              <div key={e.label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{e.label}</dt>
                <dd className="font-mono tabular-nums">{e.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </article>
  );
}

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  return (
    <article className="space-y-2 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary">Priorité {recommendation.priority}</Badge>
        <span className="text-muted-foreground">{KIND_LABELS[recommendation.kind]}</span>
      </div>
      <h3 className="font-semibold">{recommendation.title}</h3>
      <p className="text-sm text-muted-foreground">{recommendation.detail}</p>
      {recommendation.actions.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {recommendation.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      )}
      {recommendation.basedOn.length > 0 && (
        <p className="text-xs text-muted-foreground">Basé sur : {recommendation.basedOn.join(", ")}</p>
      )}
    </article>
  );
}

interface Props {
  analysis: AnalyzeResult;
  stored: StoredLoadResult;
}

export function FindingsView({ analysis, stored }: Props) {
  const findings = sortFindings(analysis.findings);
  const counts = countBySeverity(analysis.findings);
  const recommendations = [...analysis.recommendations].sort((a, b) => a.priority - b.priority);
  const { summary, dataQuality } = analysis;
  const p95Max = objectivesFromThresholds(stored.scenario?.thresholds ?? []).p95MaxMs;

  return (
    <div className="space-y-6">
      <section aria-label="Résumé du test" className="space-y-3 rounded-xl border border-border bg-card p-5">
        <p className="text-base">{buildHeadline(analysis.capacity, stored.points, p95Max)}</p>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {[
            ["Durée", `${formatInt(Math.round(summary.durationSeconds))} s`],
            ["Requêtes", formatInt(summary.totalRequests)],
            ["Débit moyen / pic", `${formatInt(Math.round(summary.avgRps))} / ${formatInt(Math.round(summary.peakRps))} req/s`],
            ["p95 de base / au pic", `${summary.baselineP95Ms !== null ? formatMs(summary.baselineP95Ms) : "—"} / ${summary.peakP95Ms !== null ? formatMs(summary.peakP95Ms) : "—"}`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {(!dataQuality.reliable || dataQuality.warnings.length > 0 || dataQuality.infraMetrics === "none") && (
        <section role="note" className="space-y-2 rounded-xl border border-border bg-muted p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Info className="size-4 text-primary" aria-hidden />
            Qualité des données
          </p>
          {dataQuality.infraMetrics === "none" && (
            <p className="text-muted-foreground">
              Aucune mesure d&apos;infrastructure : le diagnostic ne voit que la latence et le débit. Ajoute des mesures dans l&apos;onglet Infrastructure pour distinguer un processeur saturé d&apos;un pool de connexions plein.
            </p>
          )}
          {!dataQuality.reliable && <p className="text-warning">Les mesures de ce test sont peu fiables (générateur saturé ou données insuffisantes).</p>}
          {dataQuality.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {dataQuality.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="findings-title" className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="findings-title" className="text-lg font-semibold">Constats ({findings.length})</h2>
          <p className="text-sm text-muted-foreground">
            {counts.critical} haute{counts.critical > 1 ? "s" : ""} · {counts.warning} moyenne{counts.warning > 1 ? "s" : ""} · {counts.info} information{counts.info > 1 ? "s" : ""}
          </p>
        </div>
        {findings.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Aucun constat : rien d&apos;anormal n&apos;a été détecté avec ces données.</p>
        ) : (
          findings.map((f) => <FindingCard key={f.code} finding={f} />)
        )}
      </section>

      {recommendations.length > 0 && (
        <section aria-labelledby="reco-title" className="space-y-4">
          <h2 id="reco-title" className="text-lg font-semibold">Recommandations</h2>
          {recommendations.map((r) => (
            <RecommendationCard key={`${r.kind}-${r.title}`} recommendation={r} />
          ))}
          <p className="text-xs text-muted-foreground">Ces recommandations sont des pistes à valider par un test, pas des certitudes : elles ne connaissent ni ta technologie ni ton code.</p>
        </section>
      )}
    </div>
  );
}