"use client";

import { Play } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import type { ScenarioHandoff } from "@/client/features/requests/load-handoff";
import { formatDuration, formatInt } from "@/client/lib/format";
import { describePhases } from "../phases";
import { checkAgainstLimits, scenarioPeaks } from "../scenario-limits";
import { describeThreshold } from "../thresholds";
import type { PublicConfig } from "@/shared/types/public-config";

interface Props {
  planned: ScenarioHandoff;
  limits: PublicConfig["limits"] | null;
  busy: boolean;
  unavailable: boolean;
  onLaunch: () => void;
  onDismiss: () => void;
}

export function PlannedScenarioCard({ planned, limits, busy, unavailable, onLaunch, onDismiss }: Props) {
  const { scenario } = planned;
  const peaks = scenarioPeaks(scenario.executor);
  const spans = describePhases(scenario.executor);
  const problems = limits ? checkAgainstLimits(scenario, limits) : [];
  const request = scenario.workflow.steps[0]?.request;
  const blocked = problems.length > 0 || busy || unavailable;

  return (
    <section aria-labelledby="planned-title" className="space-y-5 rounded-xl border border-primary/50 bg-card p-6">
      <div>
        <h1 id="planned-title" className="text-2xl font-semibold">Test de vérification prêt</h1>
        <p className="mt-1 text-sm text-muted-foreground">{planned.label}</p>
      </div>

      {request && (
        <p className="rounded-lg border border-border bg-background/40 p-3 font-mono text-sm break-all">
          {request.method} {request.url}
        </p>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Charge au pic</dt>
          <dd className="font-mono">{peaks.peakRps !== null ? `${formatInt(Math.round(peaks.peakRps))} req/s` : `${formatInt(peaks.peakVus)} utilisateurs`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Durée</dt>
          <dd className="font-mono">{formatDuration(peaks.durationSeconds)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Phases</dt>
          <dd>{spans.map((s) => s.label).join(" → ")}</dd>
        </div>
      </dl>

      <div className="space-y-1.5">
        <h2 className="text-sm font-medium">Critères de succès</h2>
        {scenario.thresholds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun critère.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {scenario.thresholds.map((t) => (
              <li key={`${t.metric}|${t.expression}`}>{describeThreshold(t)}</li>
            ))}
          </ul>
        )}
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {busy && <p role="status" className="text-sm text-warning">Un test est déjà en cours sur cette instance : le tien serait refusé. Réessaie dans un instant.</p>}
      {unavailable && <p role="alert" className="text-sm text-destructive-text">Les tests de charge ne sont pas disponibles sur cette instance.</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={onLaunch} disabled={blocked} className="gap-2">
          <Play className="size-4" aria-hidden />
          Lancer le test de vérification
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onDismiss}>
          Préparer un autre test
        </Button>
      </div>
    </section>
  );
}