"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { formatInt, formatMs, formatPercent } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import type { StoredLoadResult } from "@/client/storage/db";
import { deleteResult, listResults } from "@/client/storage/repositories";
import { statusLabel } from "../verdict";

const TONES = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive-text",
  neutral: "text-muted-foreground",
} as const;

const DATE = new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" });

interface Props {
  onOpen: (result: StoredLoadResult) => void;
  onReplay: (result: StoredLoadResult) => void;
  onChanged: (count: number) => void;
}

export function PreviousTests({ onOpen, onReplay, onChanged }: Props) {
  const [items, setItems] = useState<StoredLoadResult[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await listResults();
      setItems(all);
      onChanged(all.length);
    } catch {
      setItems([]);
    }
  }, [onChanged]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (items === null) return <Skeleton className="h-40 w-full" />;

  if (items.length === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold">Aucun test pour l&apos;instant</h2>
        <p className="text-sm text-muted-foreground">
          Les résultats de tes tests apparaîtront ici, enregistrés dans ton navigateur (50 au maximum). Lance un premier test depuis l&apos;onglet « Nouveau test ».
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const status = statusLabel(item.result);
        const snap = item.result.snapshot;
        return (
          <li key={item.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4">
            <div className="min-w-56 flex-1 space-y-1">
              <p className="font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">{DATE.format(item.savedAt)} · {Math.round(item.result.durationSeconds)} s</p>
              <span className={cn("text-xs font-medium", TONES[status.tone])}>{status.label}</span>
            </div>
            <dl className="flex gap-6 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">p95</dt>
                <dd className="font-mono tabular-nums">{snap.http_req_duration ? formatMs(snap.http_req_duration.p95) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Débit moyen</dt>
                <dd className="font-mono tabular-nums">{formatInt(Math.round(snap.http_reqs.rate))} req/s</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Erreurs</dt>
                <dd className="font-mono tabular-nums">{snap.http_req_failed.rate !== null ? formatPercent(snap.http_req_failed.rate) : "—"}</dd>
              </div>
            </dl>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono text-[10px] uppercase">Enregistré ici</Badge>
              <Button type="button" size="sm" onClick={() => onOpen(item)}>Ouvrir</Button>
              {item.scenario && (
                <Button type="button" size="sm" variant="outline" onClick={() => onReplay(item)} className="gap-1">
                  <RotateCcw className="size-4" aria-hidden />
                  Rejouer
                </Button>
              )}
              {confirming === item.id ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-destructive/60 text-destructive-text"
                    onClick={async () => {
                      await deleteResult(item.id);
                      setConfirming(null);
                      await reload();
                    }}
                  >
                    Confirmer
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>Annuler</Button>
                </>
              ) : (
                <Button type="button" size="icon" variant="ghost" onClick={() => setConfirming(item.id)} aria-label={`Supprimer ${item.name}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}