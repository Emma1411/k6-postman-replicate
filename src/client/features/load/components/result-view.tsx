"use client";

import { ArrowLeft, ArrowRight, Info, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Explain } from "@/client/components/explain";
import { KpiCard } from "@/client/components/kpi-card";
import { ProvenanceBadge } from "@/client/components/provenance-badge";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  formatClock,
  formatInt,
  formatMs,
  formatPercent,
} from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import type { LoadScenario } from "@/shared/schemas";
import type { LoadRunResult, WindowPoint } from "@/shared/types/load-result";
import { estimateRps } from "../profile";
import { scenarioPeaks } from "../scenario-limits";
import {
  downsample,
  saturationStart,
  statusRows,
  toChartData,
} from "../series";
import { LatencyChart } from "./latency-chart";
import { ThresholdPanel } from "./threshold-panel";
import { ThroughputChart } from "./throughput-chart";
import {
  buildKpis,
  buildVerdict,
  objectivesFromThresholds,
  plateauRps,
  type Tone,
} from "../verdict";

const TONE_CLASSES: Record<Tone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/50 bg-destructive/10 text-destructive-text",
  neutral: "border-border bg-muted text-muted-foreground",
};

const CONFIDENCE_LABELS = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
} as const;
const STATUS_TONES = {
  success: "bg-success",
  info: "bg-primary",
  warning: "bg-warning",
  danger: "bg-destructive",
} as const;

interface Props {
  result: LoadRunResult;
  points: WindowPoint[];
  scenario: LoadScenario | null;
  onNew?: () => void;
  onReplay?: () => void;
  onBack?: () => void;
}

export function ResultView({
  result,
  points,
  scenario,
  onNew,
  onReplay,
  onBack,
}: Props) {
  const thresholds = useMemo(() => scenario?.thresholds ?? [], [scenario]);
  const verdict = useMemo(
    () => buildVerdict(result, points, thresholds),
    [result, points, thresholds],
  );
  const kpis = useMemo(
    () => buildKpis(result, verdict.capacity, points),
    [result, verdict.capacity, points],
  );
  const { p95MaxMs } = objectivesFromThresholds(thresholds);
  const saturationFrom = saturationStart(points, {
    breachRps: verdict.capacity?.breachRps ?? null,
    p95MaxMs,
  });
  const data = useMemo(() => downsample(toChartData(points)), [points]);
  const duration = result.snapshot.http_req_duration;
  const codes = statusRows(result.snapshot.statusDistribution);
  const peaks = scenario ? scenarioPeaks(scenario.executor) : null;
  const think = scenario?.workflow.steps[0]?.thinkTimeMs ?? 0;
  const plateau = useMemo(() => plateauRps(points), [points]);
  // Temps de réponse du palier : celui qui correspond à la charge maximale, pas la moyenne de tout le test.
  const responseMs = plateau?.avgMs ?? duration?.avg ?? 0;
  const littleRps =
    peaks && duration && scenario?.executor.type.includes("vus")
      ? estimateRps(peaks.peakVus, responseMs, think)
      : null;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-1"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Retour
          </Button>
        )}
        <h1 className="text-2xl font-semibold">{result.name}</h1>
        <span
          className={cn(
            "rounded-md border px-2.5 py-1 text-sm font-medium",
            TONE_CLASSES[verdict.status.tone],
          )}
        >
          {verdict.status.label}
        </span>
        <Badge variant="outline" className="font-mono">
          Durée : {formatClock(result.durationSeconds)}
        </Badge>
        <ProvenanceBadge kind="measured" />
      </header>

      {result.status === "aborted" && result.abortReason && (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted p-3 text-sm"
        >
          Test interrompu : {result.abortReason}
        </p>
      )}
      {result.status === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
        >
          Le test s&apos;est terminé en erreur :{" "}
          {result.error ?? "erreur inconnue"}.
        </p>
      )}

      <section
        aria-labelledby="verdict-title"
        className="space-y-4 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="verdict-title"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Verdict
          </h2>
          <span className="flex items-center gap-1.5 text-sm">
            Niveau de confiance :{" "}
            <strong>{CONFIDENCE_LABELS[verdict.confidence.level]}</strong>
            <Explain term="confidence" />
          </span>
        </div>
        <p className="text-xl font-medium leading-snug md:text-2xl">
          {verdict.headline}
        </p>
        {verdict.capacity &&
          verdict.capacity.kind === "bracketed" &&
          verdict.capacity.sustainedRps !== null &&
          verdict.capacity.breachRps !== null && (
            <p className="inline-block rounded-lg bg-background/60 px-3 py-1.5 font-mono text-sm">
              Capacité encadrée : [{" "}
              {formatInt(Math.round(verdict.capacity.sustainedRps))} –{" "}
              {formatInt(Math.round(verdict.capacity.breachRps))} req/s ]
            </p>
          )}
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {verdict.confidence.reason}
        </p>
        {verdict.analysis &&
          verdict.analysis.dataQuality.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
              {verdict.analysis.dataQuality.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild className="gap-2">
            <Link href={`/sizing?run=${encodeURIComponent(result.runId)}`}>
              Dimensionner à partir de ce résultat
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          {onReplay && (
            <Button
              type="button"
              variant="outline"
              onClick={onReplay}
              className="gap-2"
            >
              <RotateCcw className="size-4" aria-hidden />
              Rejouer
            </Button>
          )}
          {onNew && (
            <Button type="button" variant="outline" onClick={onNew}>
              Nouveau test
            </Button>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Débit maximal sain"
          term="healthyThroughput"
          value={
            kpis.sustainedRps !== null
              ? formatInt(Math.round(kpis.sustainedRps))
              : "—"
          }
          unit="req/s"
          hint={`Pic observé : ${formatInt(Math.round(kpis.peakRps))} req/s`}
          provenance="measured"
        />
        <KpiCard
          label="p95 global"
          term="p95"
          value={kpis.p95Ms !== null ? formatMs(kpis.p95Ms) : "—"}
          hint={
            p95MaxMs !== undefined && kpis.p95Ms !== null
              ? kpis.p95Ms <= p95MaxMs
                ? `Objectif respecté (< ${formatMs(p95MaxMs)})`
                : `Objectif dépassé (< ${formatMs(p95MaxMs)})`
              : undefined
          }
          tone={
            p95MaxMs !== undefined && kpis.p95Ms !== null
              ? kpis.p95Ms <= p95MaxMs
                ? "success"
                : "danger"
              : "default"
          }
          provenance="measured"
        />
        <KpiCard
          label="Taux d'erreur"
          term="errorRate"
          value={
            kpis.errorRate !== null
              ? formatPercent(kpis.errorRate).replace(" %", "")
              : "—"
          }
          unit="%"
          hint={`${formatInt(kpis.failed)} erreur${kpis.failed > 1 ? "s" : ""} sur ${formatInt(kpis.total)} requêtes`}
          tone={kpis.failed > 0 ? "warning" : "success"}
          provenance="measured"
        />
        <KpiCard
          label="Seuil de saturation"
          term="saturationPoint"
          value={
            kpis.breachRps !== null
              ? `~${formatInt(Math.round(kpis.breachRps))}`
              : "—"
          }
          unit="req/s"
          hint={
            kpis.breachRps === null ? "Non atteint pendant ce test" : undefined
          }
          provenance="estimated"
        />
      </div>

      <section
        aria-labelledby="curves-title"
        className="space-y-4 rounded-xl border border-border bg-card p-4"
      >
        <div>
          <h2 id="curves-title" className="text-base font-semibold">
            Latences et saturation
          </h2>
          <p className="text-sm text-muted-foreground">
            Un point par seconde. La zone rouge marque le moment où ton objectif
            n&apos;est plus tenu.
          </p>
        </div>
        <LatencyChart
          data={data}
          slaMs={p95MaxMs}
          saturationFrom={saturationFrom}
          ariaLabel={`Latences au fil du test. p95 global : ${kpis.p95Ms !== null ? formatMs(kpis.p95Ms) : "inconnu"}.`}
        />
        <ThroughputChart
          data={data}
          saturationFrom={saturationFrom}
          ariaLabel="Débit et utilisateurs virtuels au fil du test"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="percentiles-title"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <h2 id="percentiles-title" className="text-base font-semibold">
            Distribution des latences
          </h2>
          {duration ? (
            <dl className="space-y-1.5 text-sm">
              {[
                ["Médiane (p50)", duration.med, "p50"],
                ["p90", duration.p90, null],
                ["p95", duration.p95, "p95"],
                ["p99", duration.p99, "p99"],
                ["Maximum", duration.max, null],
                ["Moyenne", duration.avg, null],
              ].map(([label, value, term]) => (
                <div
                  key={String(label)}
                  className="flex items-center justify-between rounded-md bg-background/40 px-3 py-1.5"
                >
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    {label}
                    {term && <Explain term={term as "p50" | "p95" | "p99"} />}
                  </dt>
                  <dd className="font-mono tabular-nums">
                    {formatMs(Number(value))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune requête n&apos;a abouti.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {formatInt(result.snapshot.http_reqs.count)} requêtes · moyenne{" "}
            {formatInt(Math.round(result.snapshot.http_reqs.rate))} req/s
          </p>
        </section>

        <section
          aria-labelledby="codes-title"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <h2 id="codes-title" className="text-base font-semibold">
            Codes de statut HTTP
          </h2>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune réponse reçue.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {codes.map((row) => (
                <li key={row.code} className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <span>{row.label}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {formatInt(row.count)} ({formatPercent(row.share)})
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <div
                      className={cn("h-full", STATUS_TONES[row.tone])}
                      style={{ width: `${Math.max(row.share * 100, 0.5)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p
            className={cn(
              "text-sm font-medium",
              result.generator.saturated ? "text-warning" : "text-success",
            )}
          >
            Générateur :{" "}
            {result.generator.saturated
              ? `saturé (${result.generator.saturatedWindows} fenêtres)`
              : "fiable"}
          </p>
          <p className="text-xs text-muted-foreground">
            Retard maximal de la boucle d&apos;événements :{" "}
            {formatMs(result.generator.maxLoopDelayMs)} ·{" "}
            {result.generator.workers} worker
            {result.generator.workers > 1 ? "s" : ""}
          </p>
        </section>

        <ThresholdPanel thresholds={result.thresholds} running={false} />
      </div>

      {littleRps !== null && peaks && (
        <section
          aria-labelledby="little-title"
          className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="little-title" className="text-base font-semibold">
              La loi de Little, sur ton test
            </h2>
            <ProvenanceBadge kind="estimated" />
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            débit ≈ utilisateurs ÷ (temps de réponse + délai de réflexion)
          </p>
          <p>
            {formatInt(peaks.peakVus)} utilisateurs ÷ ({formatMs(responseMs)} +{" "}
            {formatMs(think)}) ≈{" "}
            <strong>{formatInt(Math.round(littleRps))} req/s</strong>.{" "}
            {plateau ? (
              <>
                Pendant le palier à {formatInt(plateau.vus)} utilisateurs, le
                débit mesuré est de{" "}
                <strong>{formatInt(Math.round(plateau.rps))} req/s</strong>{" "}
                (médiane)
                {Math.abs(littleRps - plateau.rps) <= plateau.rps * 0.2
                  ? " : les deux valeurs concordent, le débit est limité par le temps de réponse de l'API, pas par le générateur de charge."
                  : "."}
              </>
            ) : (
              <>
                Le test n&apos;a pas de palier assez long pour comparer ; le
                débit moyen est de{" "}
                <strong>
                  {formatInt(Math.round(result.snapshot.http_reqs.rate))} req/s
                </strong>
                .
              </>
            )}
          </p>
        </section>
      )}
    </div>
  );
}
