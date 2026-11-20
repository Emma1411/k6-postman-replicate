"use client";

import { AlertTriangle } from "lucide-react";
import { NumberField } from "@/client/components/number-field";
import { Button } from "@/client/components/ui/button";
import { validateInfra, type InfraDraft } from "../infra";

interface Props {
  value: InfraDraft;
  onChange: (value: InfraDraft) => void;
  /** Les valeurs sont celles par défaut et n'ont pas été confirmées. */
  unconfirmed: boolean;
  onConfirm: () => void;
}

export function InfraForm({ value, onChange, unconfirmed, onConfirm }: Props) {
  const set = (patch: Partial<InfraDraft>) => onChange({ ...value, ...patch });
  const problems = validateInfra(value);
  return (
    <section aria-labelledby="infra-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 id="infra-title" className="text-base font-semibold">Architecture pendant le test</h2>
        <p className="text-sm text-muted-foreground">
          Ce sur quoi ton API tournait quand tu as lancé le test. Elle sert à calibrer le calcul : sans elle, les résultats seraient faux.
        </p>
      </div>

      <div className="flex flex-wrap gap-5">
        <NumberField label="Instances" value={value.instances} onChange={(n) => set({ instances: n ?? 1 })} min={1} step={1} />
        <NumberField label="vCPU par instance" value={value.vcpuPerInstance} onChange={(n) => set({ vcpuPerInstance: n ?? 1 })} min={0.25} step={0.25} />
        <NumberField label="Mémoire par instance" value={value.ramGbPerInstance} onChange={(n) => set({ ramGbPerInstance: n ?? 1 })} min={0.25} step={0.25} unit="Go" />
        <NumberField label="Pool de connexions par instance" value={value.poolSizePerInstance} onChange={(n) => set({ poolSizePerInstance: n })} min={1} step={1} nullable hint="Facultatif" />
        <NumberField label="Connexions maximales de la base" value={value.dbMaxConnections} onChange={(n) => set({ dbMaxConnections: n })} min={1} step={1} nullable hint="Facultatif" />
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {unconfirmed && (
        <div role="note" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">Ce sont des valeurs par défaut : remplace-les par celles de ton déploiement.</span>
          <Button type="button" size="sm" variant="outline" onClick={onConfirm}>
            C&apos;est bien mon architecture
          </Button>
        </div>
      )}
    </section>
  );
}