"use client";

import { Check, Clock, X } from "lucide-react";
import { cn } from "@/client/lib/utils";
import { formatMs } from "@/client/lib/format";
import type { ThresholdResult } from "@/shared/types/load-result";
import { describeThreshold, formatThresholdValue } from "../thresholds";

interface Props {
  thresholds: ThresholdResult[];
  /** p95 de la dernière fenêtre d'une seconde (en direct). */
  windowP95?: number | null;
  /** En direct : on parle de « conforme » ; à la fin : de « réussi ». */
  running: boolean;
}

export function ThresholdPanel({ thresholds, windowP95, running }: Props) {
  return (
    <section aria-labelledby="thresholds-title" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 id="thresholds-title" className="text-base font-semibold">Critères de succès</h2>
      {thresholds.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun critère n&apos;a été choisi pour ce test.</p>
      ) : (
        <ul className="space-y-2">
          {thresholds.map((t) => {
            const state = t.noData ? "waiting" : t.passed ? "ok" : "ko";
            return (
              <li key={`${t.metric}|${t.expression}`} className="space-y-1 rounded-lg border border-border bg-background/40 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span>{describeThreshold(t)}</span>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1 text-xs font-medium",
                      state === "ok" && "text-success",
                      state === "ko" && "text-destructive-text",
                      state === "waiting" && "text-muted-foreground",
                    )}
                  >
                    {state === "ok" ? <Check className="size-3.5" aria-hidden /> : state === "ko" ? <X className="size-3.5" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
                    {state === "waiting" ? (running ? "En attente de données" : "Sans donnée") : state === "ok" ? (running ? "Conforme" : "Réussi") : running ? "Non respecté" : "Échoué"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {running ? "Valeur cumulée depuis le début" : "Valeur finale"} : <span className="font-mono">{formatThresholdValue(t)}</span>
                  {running && t.metric === "http_req_duration" && windowP95 != null && (
                    <>
                      {" "}
                      · dernière seconde : <span className="font-mono">{formatMs(windowP95)}</span>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}