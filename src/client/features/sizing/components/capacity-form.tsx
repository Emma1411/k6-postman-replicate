"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { NumberField } from "@/client/components/number-field";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { MAX_SCENARIOS, newScenario, type CapacityDraft, type CapacityMode, type ScenarioDraft } from "../capacity-input";
import type { InfraDraft } from "../infra";

const MODES: Array<{ mode: CapacityMode; title: string; text: string }> = [
  { mode: "measured", title: "À partir d'un test mesuré", text: "Le calcul s'appuie sur le test choisi en haut de page." },
  { mode: "predictive", title: "À partir d'hypothèses", text: "Tu connais le coût d'une requête : pas besoin de test." },
];

interface Props {
  draft: CapacityDraft;
  infra: InfraDraft;
  onChange: (draft: CapacityDraft) => void;
  problems: string[];
  loading: boolean;
  hasRun: boolean;
  onCompute: () => void;
}

export function CapacityForm({ draft, infra, onChange, problems, loading, hasRun, onCompute }: Props) {
  const setObjectives = (patch: Partial<CapacityDraft["objectives"]>) => onChange({ ...draft, objectives: { ...draft.objectives, ...patch } });
  const setAssumptions = (patch: Partial<CapacityDraft["assumptions"]>) => onChange({ ...draft, assumptions: { ...draft.assumptions, ...patch } });
  const setScenario = (index: number, patch: Partial<ScenarioDraft>) =>
    onChange({ ...draft, extraScenarios: draft.extraScenarios.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="sr-only">Mode de calcul</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m.mode}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/40",
                "has-[input:checked]:border-primary has-[input:checked]:bg-primary/5 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring",
              )}
            >
              <input type="radio" name="capacity-mode" className="sr-only" checked={draft.mode === m.mode} onChange={() => onChange({ ...draft, mode: m.mode })} />
              <span className="text-sm font-medium">{m.title}</span>
              <span className="text-xs text-muted-foreground">{m.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {draft.mode === "measured" && !hasRun && (
        <p role="note" className="text-sm text-warning">Aucun test n&apos;est sélectionné : lance un test depuis la page Test de charge, ou passe en mode « à partir d&apos;hypothèses ».</p>
      )}

      {draft.mode === "predictive" && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Ton service</h2>
          <div className="flex flex-wrap gap-5">
            <NumberField label="Processeur consommé par requête" unit="ms" value={draft.predictive.cpuMsPerRequest} nullable step={0.5} onChange={(n) => onChange({ ...draft, predictive: { ...draft.predictive, cpuMsPerRequest: n } })} hint="Le temps de CPU, pas le temps de réponse." />
            <NumberField label="Latence p95 à faible charge" unit="ms" value={draft.predictive.baselineP95Ms} nullable step={1} onChange={(n) => onChange({ ...draft, predictive: { ...draft.predictive, baselineP95Ms: n } })} />
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">Objectif à atteindre</h2>
        <div className="flex flex-wrap gap-5">
          <NumberField label="Débit à absorber" unit="req/s" value={draft.objectives.targetRps} nullable step={10} onChange={(n) => setObjectives({ targetRps: n })} hint="Obligatoire" />
          <NumberField label="Latence p95 visée" unit="ms" value={draft.objectives.p95MaxMs} nullable step={10} onChange={(n) => setObjectives({ p95MaxMs: n })} />
          <NumberField label="Taux d'erreur acceptable" unit="%" value={draft.objectives.maxErrorPercent} step={0.1} onChange={(n) => setObjectives({ maxErrorPercent: n ?? 1 })} />
          <NumberField label="Marge de sécurité" unit="%" value={draft.objectives.headroomPercent} step={5} onChange={(n) => setObjectives({ headroomPercent: n ?? 0 })} hint="Capacité en réserve au-delà de l'objectif" />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold">Architectures à comparer</h2>
          <p className="text-sm text-muted-foreground">L&apos;architecture actuelle est toujours calculée. Ajoute des variantes pour voir ce qu&apos;elles changeraient.</p>
        </div>
        {draft.extraScenarios.map((s, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
            <div className="flex items-center gap-2">
              <Input value={s.name} onChange={(e) => setScenario(i, { name: e.target.value })} aria-label={`Nom de la variante ${i + 1}`} maxLength={100} className="max-w-xs" />
              <Button type="button" variant="ghost" size="icon" className="ml-auto" onClick={() => onChange({ ...draft, extraScenarios: draft.extraScenarios.filter((_, j) => j !== i) })} aria-label={`Supprimer la variante ${s.name || i + 1}`}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap gap-4">
              <NumberField label="Instances" value={s.instances} min={1} step={1} onChange={(n) => setScenario(i, { instances: n ?? 1 })} />
              <NumberField label="vCPU" value={s.vcpuPerInstance} min={0.25} step={0.25} onChange={(n) => setScenario(i, { vcpuPerInstance: n ?? 1 })} />
              <NumberField label="Mémoire" unit="Go" value={s.ramGbPerInstance} min={0.25} step={0.25} onChange={(n) => setScenario(i, { ramGbPerInstance: n ?? 1 })} />
              <NumberField label="Pool par instance" value={s.poolSizePerInstance} min={1} step={1} nullable onChange={(n) => setScenario(i, { poolSizePerInstance: n })} />
              <NumberField label="Connexions max de la base" value={s.dbMaxConnections} min={1} step={1} nullable onChange={(n) => setScenario(i, { dbMaxConnections: n })} />
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={draft.extraScenarios.length >= MAX_SCENARIOS} onClick={() => onChange({ ...draft, extraScenarios: [...draft.extraScenarios, newScenario(infra, `Variante ${draft.extraScenarios.length + 1}`)] })} className="gap-1">
          <Plus className="size-4" aria-hidden />
          Ajouter une variante
        </Button>
      </section>

      <details className="rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-base font-semibold">Hypothèses (mode avancé)</summary>
        <p className="mt-2 text-sm text-muted-foreground">Laisse vide pour que le modèle choisisse. Chaque valeur utilisée est listée avec sa source dans le résultat.</p>
        <div className="mt-4 flex flex-wrap gap-5">
          <NumberField label="Part non parallélisable" unit="%" value={draft.assumptions.scaleOutSerialPercent} nullable step={1} max={100} onChange={(n) => setAssumptions({ scaleOutSerialPercent: n })} hint="Travail qui ne gagne rien à ajouter des instances (base de données partagée, verrous…)" />
          <NumberField label="Variabilité du service" value={draft.assumptions.serviceVariability} nullable step={0.5} max={25} onChange={(n) => setAssumptions({ serviceVariability: n })} hint="1 = temps de service très régulier" />
          <NumberField label="Réserve de connexions de la base" unit="%" value={draft.assumptions.dbConnectionHeadroomPercent} nullable step={5} max={90} onChange={(n) => setAssumptions({ dbConnectionHeadroomPercent: n })} />
          <NumberField label="Temps de réponse moyen" unit="ms" value={draft.assumptions.avgResponseMs} nullable step={1} onChange={(n) => setAssumptions({ avgResponseMs: n })} />
        </div>
      </details>

      <div className="space-y-3">
        {problems.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <Button type="button" size="lg" onClick={onCompute} disabled={loading || problems.length > 0} className="gap-2">
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Calculer
        </Button>
      </div>
    </div>
  );
}