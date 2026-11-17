"use client";

import { AlertTriangle, Info, WifiOff } from "lucide-react";
import { useMemo } from "react";
import { Explain } from "@/client/components/explain";
import { KpiCard } from "@/client/components/kpi-card";
import { Badge } from "@/client/components/ui/badge";
import { Progress } from "@/client/components/ui/progress";
import { Skeleton } from "@/client/components/ui/skeleton";
import { formatClock, formatInt, formatMs, formatPercent } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import { useAppSelector } from "@/client/store/hooks";
import { describePhases } from "../phases";
import { scenarioPeaks } from "../scenario-limits";
import { downsample, toChartData } from "../series";
import { objectivesFromThresholds } from "../verdict";
import { CancelDialog } from "./cancel-dialog";
import { LatencyChart } from "./latency-chart";
import { ThresholdPanel } from "./threshold-panel";
import { ThroughputChart } from "./throughput-chart";

function Banner({ tone, icon, children }: { tone: "warning" | "danger" | "info"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p
      role={tone === "info" ? "note" : "alert"}
      className={cn(
        "flex gap-2 rounded-lg border p-3 text-sm",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "danger" && "border-destructive/50 bg-destructive/10",
        tone === "info" && "border-border bg-muted",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

export function LiveDashboard({ onCancel, cancelError }: { onCancel: () => Promise<void>; cancelError: string | null }) {
  const { phase, run, scenario, points, snapshot, thresholds, generator, connection, stopping, log } = useAppSelector((s) => s.load);
  const last = points.at(-1);

  const peaks = scenario ? scenarioPeaks(scenario.executor) : null;
  const planned = run?.plannedDurationSeconds || peaks?.durationSeconds || 0;
  const elapsed = last?.t ?? 0;
  const percent = planned > 0 ? Math.min(100, (elapsed / planned) * 100) : 0;
  const spans = useMemo(() => (scenario ? describePhases(scenario.executor) : []), [scenario]);
  const slaMs = objectivesFromThresholds(scenario?.thresholds ?? []).p95MaxMs;
  const data = useMemo(() => downsample(toChartData(points)), [points]);
  const target = scenario?.workflow.steps[0]?.request;

  if (phase === "starting" && points.length === 0) {
    return (
      <div className="space-y-4" aria-live="polite">
        <p className="text-sm text-muted-foreground">Démarrage du test sur le serveur…</p>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const p95 = last?.duration?.p95 ?? null;
  const slaBroken = slaMs !== undefined && p95 !== null && p95 > slaMs;

  return (
    <div className="space-y-6">
      <header className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="gap-1.5">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-current" />
            Exécution en direct
          </Badge>
          {run && <span className="font-mono text-xs text-muted-foreground">#{run.runId.slice(0, 8)}</span>}
          <span className="font-mono text-lg tabular-nums">
            {formatClock(elapsed)} <span className="text-muted-foreground">/ {formatClock(planned)}</span>
          </span>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">{percent.toFixed(1).replace(".", ",")} %</span>
          <div className="ml-auto">
            <CancelDialog onConfirm={onCancel} stopping={stopping !== null} />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-semibold">{run?.name ?? scenario?.name ?? "Test de charge"}</h1>
          {target && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{target.method} {target.url}</p>}
        </div>

        <div className="space-y-2">
          <Progress value={percent} aria-label="Avancement du test" />
          {planned > 0 && spans.length > 0 && (
            <div className="flex gap-0.5 text-xs text-muted-foreground" aria-hidden>
              {spans.map((span, i) => {
                const width = ((span.endSeconds - span.startSeconds) / planned) * 100;
                const active = elapsed > span.startSeconds && elapsed <= span.endSeconds;
                return (
                  <div key={i} style={{ width: `${width}%` }} className={cn("truncate border-t-2 pt-1", active ? "border-primary text-foreground" : "border-border")}>
                    {span.label}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {connection === "reconnecting" && (
        <Banner tone="warning" icon={<WifiOff className="size-4 text-warning" aria-hidden />}>
          Connexion interrompue : reconnexion au test en cours… Il continue côté serveur.
        </Banner>
      )}
      {connection === "lost" && (
        <Banner tone="danger" icon={<WifiOff className="size-4 text-destructive-text" aria-hidden />}>
          Le suivi en direct s&apos;est arrêté. Le test peut continuer côté serveur : recharge la page pour le retrouver.
        </Banner>
      )}
      {generator?.saturated && (
        <Banner tone="warning" icon={<AlertTriangle className="size-4 text-warning" aria-hidden />}>
          <strong>Générateur saturé.</strong> L&apos;outil manque lui-même de ressources : les mesures sont peu fiables. Réduis la charge pour un résultat exploitable.
        </Banner>
      )}
      {cancelError && (
        <Banner tone="danger" icon={<AlertTriangle className="size-4 text-destructive-text" aria-hidden />}>
          Impossible d&apos;annuler le test : {cancelError}
        </Banner>
      )}
      <Banner tone="info" icon={<Info className="size-4 text-primary" aria-hidden />}>
        <strong>Ce test dépend de cette page.</strong> Si tu la quittes, il continue 30 secondes puis s&apos;arrête s&apos;il n&apos;y a plus de connexion.
      </Banner>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Utilisateurs virtuels"
          term="vu"
          value={last ? formatInt(last.vus) : "—"}
          unit={peaks ? `/ ${formatInt(peaks.peakVus)}` : undefined}
          provenance="measured"
        />
        <KpiCard
          label="Débit (dernière seconde)"
          term="rps"
          value={last ? formatInt(Math.round(last.rps)) : "—"}
          unit="req/s"
          hint={snapshot ? `Moyenne : ${formatInt(Math.round(snapshot.http_reqs.rate))} req/s · ${formatInt(snapshot.http_reqs.count)} requêtes` : undefined}
          provenance="measured"
        />
        <KpiCard
          label="p95 (dernière seconde)"
          term="p95"
          value={p95 !== null ? formatMs(p95) : "—"}
          hint={slaMs !== undefined ? (slaBroken ? `Objectif dépassé (< ${formatMs(slaMs)})` : `Sous ton objectif (< ${formatMs(slaMs)})`) : undefined}
          tone={slaBroken ? "danger" : "default"}
          provenance="measured"
        />
        <KpiCard
          label="Erreurs (dernière seconde)"
          term="errorRate"
          value={last ? formatInt(last.failed) : "—"}
          unit="err/s"
          hint={snapshot ? `Cumul : ${formatInt(snapshot.http_req_failed.fails)} (${snapshot.http_req_failed.rate !== null ? formatPercent(snapshot.http_req_failed.rate) : "—"})` : undefined}
          tone={last && last.failed > 0 ? "warning" : "default"}
          provenance="measured"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section aria-labelledby="latency-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 id="latency-title" className="text-base font-semibold">Latences</h2>
            <LatencyChart data={data} slaMs={slaMs} ariaLabel={`Latences p50, p95 et p99 au fil du test. Dernier p95 : ${p95 !== null ? formatMs(p95) : "inconnu"}.`} />
          </section>
          <section aria-labelledby="load-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 id="load-title" className="text-base font-semibold">Charge, débit et erreurs</h2>
            <ThroughputChart data={data} ariaLabel="Débit et utilisateurs virtuels au fil du test" />
          </section>
        </div>

        <div className="space-y-6">
          <ThresholdPanel thresholds={thresholds} windowP95={p95} running />

          <section aria-labelledby="generator-title" className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
            <h2 id="generator-title" className="flex items-center gap-1 text-base font-semibold">
              Santé du générateur <Explain term="generatorSaturation" />
            </h2>
            <p className={cn("font-medium", generator?.saturated ? "text-warning" : "text-success")}>
              {generator ? (generator.saturated ? "Saturé : mesures peu fiables" : "Fiable : les mesures reflètent ton API") : "En attente de mesures"}
            </p>
            {generator && (
              <p className="text-xs text-muted-foreground">
                Retard de la boucle d&apos;événements (p99) : <span className="font-mono">{formatMs(generator.loopDelayP99Ms)}</span>
              </p>
            )}
          </section>

          <section aria-labelledby="log-title" className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h2 id="log-title" className="text-base font-semibold">Journal des événements</h2>
            <ol className="max-h-72 space-y-1.5 overflow-y-auto text-xs" aria-live="polite">
              {[...log].reverse().map((entry, i) => (
                <li key={`${entry.t}-${i}`} className="flex gap-2">
                  <span className="shrink-0 font-mono text-muted-foreground">{formatClock(entry.t)}</span>
                  <span className={cn(entry.level === "warning" && "text-warning", entry.level === "error" && "text-destructive-text")}>{entry.message}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}