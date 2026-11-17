"use client";

import { Check, Globe, Server } from "lucide-react";
import { Explain } from "@/client/components/explain";
import { Badge } from "@/client/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { buildLimitRows } from "@/client/content/limit-rows";
import type { PublicConfig } from "@/shared/types/public-config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: PublicConfig;
}

export function LimitsDialog({ open, onOpenChange, config }: Props) {
  const rows = buildLimitRows(config);
  const isPublic = config.deploymentMode === "public";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Limites de cette instance</DialogTitle>
          <DialogDescription>
            Ces plafonds protègent le serveur partagé et gardent les mesures fiables pour tout le monde. Un test qui les
            dépasse est refusé avant de démarrer, avec la liste des dépassements.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Paramètre</th>
                <th scope="col" className="px-4 py-2 font-medium">Plafond</th>
                <th scope="col" className="px-4 py-2 font-medium">Pourquoi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-3 font-normal">
                    <span className="inline-flex items-center gap-1">
                      {row.label}
                      {row.term && <Explain term={row.term} />}
                    </span>
                  </th>
                  <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums">{row.value}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <section className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Globe className="size-4 text-primary" aria-hidden />
              Mode public
              {isPublic && <Badge variant="secondary">Actuel</Badge>}
            </h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />Aucune configuration, exécution immédiate.</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />Les adresses privées (localhost, réseaux d&apos;entreprise) sont refusées.</li>
            </ul>
          </section>
          <section className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Server className="size-4 text-primary" aria-hidden />
              Mode privé (auto-hébergé)
              {!isPublic && <Badge variant="secondary">Actuel</Badge>}
            </h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />Limites fixées par l&apos;administrateur de l&apos;instance.</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />Réseaux privés autorisables pour tester des API internes.</li>
            </ul>
          </section>
        </div>

        <p className="text-sm text-muted-foreground">
          Besoin de charges plus élevées ? Lance ta propre instance avec Docker : c&apos;est décrit dans le README du projet.
        </p>
      </DialogContent>
    </Dialog>
  );
}