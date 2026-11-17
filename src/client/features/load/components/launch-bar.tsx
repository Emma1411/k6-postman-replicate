"use client";

import { Check, Play, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { formatDuration, formatInt } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import type { ScenarioPeaks } from "../scenario-limits";

interface Props {
  peaks: ScenarioPeaks | null;
  limits: { maxVus: number; maxDurationSeconds: number; maxRequestsPerSecond: number } | null;
  problems: string[];
  busy: boolean;
  unavailable: boolean;
  hasTarget: boolean;
  onLaunch: () => void;
}

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-1.5", !ok && "text-destructive-text")}>
      {ok ? <Check className="size-4 text-success" aria-hidden /> : <X className="size-4" aria-hidden />}
      {children}
    </li>
  );
}

export function LaunchBar({ peaks, limits, problems, busy, unavailable, hasTarget, onLaunch }: Props) {
  const blocked = !hasTarget || problems.length > 0 || busy || unavailable;
  return (
    <section aria-label="Conformité et lancement" className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-5">
      <div className="min-w-64 flex-1 space-y-2">
        <h2 className="text-sm font-medium">Conformité avec cette instance</h2>
        {peaks && limits && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Line ok={peaks.peakVus <= limits.maxVus}>
              Charge : <span className="font-mono tabular-nums">{formatInt(peaks.peakVus)} / {formatInt(limits.maxVus)}</span> VU
            </Line>
            <Line ok={peaks.durationSeconds <= limits.maxDurationSeconds}>
              Durée : <span className="font-mono tabular-nums">{formatDuration(peaks.durationSeconds)} / {formatDuration(limits.maxDurationSeconds)}</span>
            </Line>
            {peaks.peakRps !== null && (
              <Line ok={peaks.peakRps <= limits.maxRequestsPerSecond}>
                Débit : <span className="font-mono tabular-nums">{formatInt(peaks.peakRps)} / {formatInt(limits.maxRequestsPerSecond)}</span> req/s
              </Line>
            )}
          </ul>
        )}
        {problems.length > 0 && (
          <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive-text">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {busy && (
          <p role="status" className="text-sm text-warning">
            Un test est déjà en cours sur cette instance : le tien serait refusé. Réessaie dans un instant.
          </p>
        )}
        {unavailable && (
          <p role="alert" className="text-sm text-destructive-text">
            Les tests de charge ne sont pas disponibles sur cette instance.
          </p>
        )}
        {!busy && !unavailable && problems.length === 0 && hasTarget && (
          <p className="text-sm text-muted-foreground">Instance disponible : le test peut partir tout de suite.</p>
        )}
      </div>
      <Button type="button" size="lg" onClick={onLaunch} disabled={blocked} className="gap-2">
        <Play className="size-4" aria-hidden />
        Lancer le test de charge{peaks ? ` (${formatDuration(peaks.durationSeconds)})` : ""}
      </Button>
    </section>
  );
}