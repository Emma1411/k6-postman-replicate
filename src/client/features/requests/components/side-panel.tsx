"use client";

import { History, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import { cn } from "@/client/lib/utils";
import { useAppDispatch, useAppSelector } from "@/client/store/hooks";
import { listHistory } from "@/client/storage/repositories";
import type { HistoryEntry } from "@/client/storage/db";
import { chooseEnvironment } from "../environments-slice";
import { loadDraft } from "../editor-slice";
import { isRequestDraft } from "../model";
import { EnvironmentDialog } from "./environment-dialog";

function methodOf(entry: HistoryEntry): string {
  return entry.label.split(" ")[0] ?? "";
}

export function SidePanel({ refreshKey }: { refreshKey: number }) {
  const dispatch = useAppDispatch();
  const { items, selectedId } = useAppSelector((s) => s.environments);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listHistory(15)
      .then((entries) => !cancelled && setHistory(entries))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <aside className="space-y-6" aria-label="Environnement et historique">
      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Environnement</h2>
        <Select
          value={selectedId ?? "none"}
          onValueChange={(value) => dispatch(chooseEnvironment(value === "none" ? null : value))}
        >
          <SelectTrigger aria-label="Environnement actif">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Aucun environnement</SelectItem>
            {items.map((env) => (
              <SelectItem key={env.id} value={env.id}>
                {env.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => setDialogOpen(true)}>
          <Settings2 className="size-4" aria-hidden />
          Variables
        </Button>
        <EnvironmentDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <History className="size-4" aria-hidden />
          Récentes
        </h2>
        {history === null ? null : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tes requêtes envoyées apparaîtront ici, enregistrées dans ton navigateur.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((entry) => {
              const draft = entry.summary.draft;
              const status = typeof entry.summary.status === "number" ? entry.summary.status : null;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => isRequestDraft(draft) && dispatch(loadDraft(draft))}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="w-14 shrink-0 font-mono text-xs text-primary">{methodOf(entry)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.label.slice(methodOf(entry).length + 1)}</span>
                    {status !== null && (
                      <span className={cn("shrink-0 font-mono text-xs", status >= 400 ? "text-destructive-text" : "text-success")}>{status}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="px-1 text-xs text-muted-foreground">
        Les collections, les dossiers et l&apos;import Postman / OpenAPI arrivent à l&apos;étape suivante.
      </p>
    </aside>
  );
}