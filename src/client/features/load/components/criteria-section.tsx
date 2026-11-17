"use client";

import { Explain } from "@/client/components/explain";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import type { CriteriaDraft } from "../profile";

function Criterion({
  title,
  symbol,
  unit,
  value,
  enabled,
  onEnabled,
  onValue,
  disabledReason,
  helper,
  explain,
}: {
  title: string;
  symbol: string;
  unit: string;
  value: number;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  onValue: (value: number) => void;
  disabledReason?: string;
  helper: string;
  explain?: "p95" | "errorRate" | "threshold";
}) {
  const disabled = Boolean(disabledReason);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/40 p-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={enabled && !disabled} disabled={disabled} onCheckedChange={(c) => onEnabled(c === true)} />
        {title}
        {explain && <Explain term={explain} />}
      </label>
      <div className="flex items-center gap-2">
        <span className="font-mono text-muted-foreground">{symbol}</span>
        <Input
          type="number"
          min={0}
          value={value}
          disabled={!enabled || disabled}
          onChange={(e) => onValue(e.target.value === "" ? 0 : Number(e.target.value))}
          aria-label={`${title} : valeur`}
          className="w-28 font-mono"
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <p className="text-xs text-muted-foreground">{disabledReason ?? helper}</p>
    </div>
  );
}

interface Props {
  criteria: CriteriaDraft;
  onChange: (criteria: CriteriaDraft) => void;
  hasAssertions: boolean;
}

export function CriteriaSection({ criteria, onChange, hasAssertions }: Props) {
  return (
    <section aria-labelledby="criteria-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">3</span>
        <h2 id="criteria-title" className="text-lg font-semibold">Critères de succès</h2>
        <Explain term="threshold" />
      </div>
      <p className="text-sm text-muted-foreground">
        Ton test réussit si ces règles sont respectées à la fin. Elles servent aussi d&apos;objectifs pour calculer la capacité.
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        <Criterion
          title="Latence p95 maximale"
          explain="p95"
          symbol="<"
          unit="ms"
          value={criteria.p95.maxMs}
          enabled={criteria.p95.enabled}
          onEnabled={(enabled) => onChange({ ...criteria, p95: { ...criteria.p95, enabled } })}
          onValue={(maxMs) => onChange({ ...criteria, p95: { ...criteria.p95, maxMs } })}
          helper="19 requêtes sur 20 doivent répondre plus vite."
        />
        <Criterion
          title="Taux d'erreur maximal"
          explain="errorRate"
          symbol="<"
          unit="%"
          value={criteria.errors.maxPercent}
          enabled={criteria.errors.enabled}
          onEnabled={(enabled) => onChange({ ...criteria, errors: { ...criteria.errors, enabled } })}
          onValue={(maxPercent) => onChange({ ...criteria, errors: { ...criteria.errors, maxPercent } })}
          helper="1 % = 1 requête sur 100 en échec."
        />
        <Criterion
          title="Vérifications réussies"
          symbol=">"
          unit="%"
          value={criteria.checks.minPercent}
          enabled={criteria.checks.enabled}
          onEnabled={(enabled) => onChange({ ...criteria, checks: { ...criteria.checks, enabled } })}
          onValue={(minPercent) => onChange({ ...criteria, checks: { ...criteria.checks, minPercent } })}
          disabledReason={hasAssertions ? undefined : "Ajoute des assertions à la requête pour activer ce critère."}
          helper="Part des assertions de la requête qui doivent réussir."
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-background/40 p-4">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={criteria.failFast}
            onCheckedChange={(c) => onChange({ ...criteria, failFast: c === true })}
          />
          <span>
            <span className="font-medium">Arrêter dès qu&apos;un critère est violé</span>
            <span className="block text-muted-foreground">
              Protège ton service, mais empêche d&apos;observer ce qui se passe au-delà de la limite. Pour trouver la capacité d&apos;une API,
              laisse décoché.
            </span>
          </span>
        </label>
        {criteria.failFast && (
          <label className="flex items-center gap-2 pl-6 text-sm">
            <span className="text-muted-foreground">Délai de grâce au démarrage</span>
            <Input
              type="number"
              min={0}
              value={criteria.failFastDelaySeconds}
              onChange={(e) => onChange({ ...criteria, failFastDelaySeconds: e.target.value === "" ? 0 : Number(e.target.value) })}
              className="w-20 font-mono"
            />
            <span className="text-muted-foreground">s</span>
          </label>
        )}
      </div>
    </section>
  );
}