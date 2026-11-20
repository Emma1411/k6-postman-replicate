"use client";

import { AlertTriangle, ArrowRight, Check, Minus, X } from "lucide-react";
import { ProvenanceBadge } from "@/client/components/provenance-badge";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Explain } from "@/client/components/explain";
import { formatInt, formatMs } from "@/client/lib/format";
import { cn } from "@/client/lib/utils";
import type { Tone } from "@/client/features/load/verdict";
import type { CapacityResult, CheckStatus, ScenarioResult } from "@/shared/types/capacity-result";
import {
  ASSUMPTION_SOURCES,
  CHECK_COPY,
  CHECK_LABELS,
  VERDICT_COPY,
  capacityBand,
  describeSizing,
  formatRps,
  limitedByLabel,
  verificationSummary,
} from "../capacity-copy";
import { confidenceLabel } from "../analysis";

const TONE_CLASSES: Record<Tone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/50 bg-destructive/10 text-destructive-text",
  neutral: "border-border bg-muted text-muted-foreground",
};

function CheckIcon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <Check className="size-4 text-success" aria-hidden />;
  if (status === "fail") return <X className="size-4 text-destructive-text" aria-hidden />;
  if (status === "marginal") return <AlertTriangle className="size-4 text-warning" aria-hidden />;
  return <Minus className="size-4 text-muted-foreground" aria-hidden />;
}

function ScenarioCard({ scenario, requiredRps }: { scenario: ScenarioResult; requiredRps: number }) {
  const verdict = VERDICT_COPY[scenario.verdict];
  const band = capacityBand(scenario);
  const limited = limitedByLabel(scenario.capacity.limitedBy);
  const { atTarget } = scenario;
  const stats: Array<[string, string]> = [
    ["Processeur à la charge visée", atTarget.cpuUtilizationPercent !== null ? `${formatInt(Math.round(atTarget.cpuUtilizationPercent))} %` : "—"],
    ["p95 estimé", atTarget.p95Ms !== null ? `${formatMs(atTarget.p95Ms)}${atTarget.p95PessimisticMs !== null ? ` (pessimiste : ${formatMs(atTarget.p95PessimisticMs)})` : ""}` : "—"],
    ["Mémoire", atTarget.memoryPercent !== null ? `${formatInt(Math.round(atTarget.memoryPercent))} %` : "—"],
    ["Connexions à la base", atTarget.databaseConnections !== null ? formatInt(Math.round(atTarget.databaseConnections)) : "—"],
  ];

  return (
    <article className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{scenario.name}</h3>
        {scenario.isReference && <Badge variant="outline">Architecture actuelle</Badge>}
        <span className={cn("rounded-md border px-2.5 py-1 text-sm font-medium", TONE_CLASSES[verdict.tone])}>{verdict.label}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          Confiance : {confidenceLabel(scenario.confidence)}
          <Explain term="confidence" />
        </span>
        <ProvenanceBadge kind="estimated" />
      </div>
      <p className="text-sm text-muted-foreground">{verdict.text}</p>

      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Capacité estimée <Explain term="capacity" /></dt>
          <dd className="font-mono">{band ?? "—"}</dd>
          {limited && <dd className="text-xs text-muted-foreground">{limited}</dd>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ressources totales</dt>
          <dd className="font-mono">{formatInt(scenario.totals.vcpu)} vCPU · {formatInt(scenario.totals.ramGb)} Go</dd>
        </div>
        {scenario.vsBaseline && scenario.vsBaseline.capacityChangePercent !== null && (
          <div>
            <dt className="text-xs text-muted-foreground">Par rapport à l&apos;architecture actuelle</dt>
            <dd className="font-mono">{scenario.vsBaseline.capacityChangePercent > 0 ? "+" : ""}{formatInt(Math.round(scenario.vsBaseline.capacityChangePercent))} % de capacité</dd>
          </div>
        )}
      </dl>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">À {formatRps(requiredRps)} (charge visée avec marge)</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-background/40 p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ul className="grid gap-2 md:grid-cols-2">
        {(Object.keys(CHECK_LABELS) as Array<keyof typeof CHECK_LABELS>).map((key) => {
          const check = scenario.checks[key];
          const copy = CHECK_COPY[check.status];
          return (
            <li key={key} className="flex gap-2 rounded-lg border border-border bg-background/40 p-3 text-sm">
              <span className="mt-0.5"><CheckIcon status={check.status} /></span>
              <div className="min-w-0">
                <p className="font-medium">
                  {CHECK_LABELS[key]} <span className={cn("text-xs font-normal", TONE_CLASSES[copy.tone].split(" ").pop())}>· {copy.label}</span>
                </p>
                <p className="text-muted-foreground">{check.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {scenario.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {scenario.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {scenario.unchecked.length > 0 && (
        <p className="text-xs text-muted-foreground">Non vérifié faute de données : {scenario.unchecked.join(", ")}.</p>
      )}
    </article>
  );
}

interface Props {
  result: CapacityResult;
  verification: { blockers: string[]; error: string | null; ready: boolean };
  onVerify: () => void;
}

export function CapacityResultView({ result, verification, onVerify }: Props) {
  const sizing = describeSizing(result.sizing, result.target);
  const best = result.best ? result.scenarios[result.best.index] : null;

  return (
    <div className="space-y-6">
      <p role="note" className="rounded-lg border border-border bg-muted p-3 text-sm">
        <strong>Estimation indicative.</strong> Ces résultats viennent d&apos;un modèle de files d&apos;attente : vérifie-les par un test de charge avant toute décision.
      </p>

      <section className="space-y-2 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">Objectif</h2>
        <p className="text-sm">
          Absorber <strong>{formatRps(result.target.targetRps)}</strong>, soit <strong>{formatRps(result.target.requiredRps)}</strong> avec {formatInt(result.target.headroomPercent)} % de marge
          {result.target.p95MaxMs !== null ? <>, avec un p95 sous <strong>{formatMs(result.target.p95MaxMs)}</strong></> : null}.
        </p>
      </section>

      {result.scenarios.map((s) => (
        <ScenarioCard key={s.name} scenario={s} requiredRps={result.target.requiredRps} />
      ))}
      {best && result.best && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm">
          <strong>Meilleure option : {best.name}.</strong> {result.best.reason}
        </p>
      )}

      <section aria-labelledby="sizing-title" className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <h2 id="sizing-title" className="text-base font-semibold">Dimensionnement recommandé</h2>
          <ProvenanceBadge kind="estimated" />
        </div>
        <ul className="space-y-1.5 text-sm">
          {sizing.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
        {result.sizing.explanation && <p className="text-xs text-muted-foreground">{result.sizing.explanation}</p>}
      </section>

      <section aria-labelledby="verify-title" className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 id="verify-title" className="text-base font-semibold">Plan de vérification</h2>
        <p className="text-sm text-muted-foreground">
          Un test à cadence croissante, avec des seuils calibrés sur ton objectif, pour confirmer ou infirmer cette estimation : {verificationSummary(result.verification)}.
        </p>
        {result.verification.notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {result.verification.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {verification.blockers.length > 0 && (
          <div role="alert" className="space-y-1 text-sm text-destructive-text">
            <p>Ce test dépasse les limites de cette instance :</p>
            <ul className="list-disc pl-5">
              {verification.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">Tu peux le lancer sur ta propre instance, où les limites sont celles que tu fixes.</p>
          </div>
        )}
        {verification.error && <p role="alert" className="text-sm text-destructive-text">{verification.error}</p>}
        <Button type="button" onClick={onVerify} disabled={!verification.ready || verification.blockers.length > 0} className="gap-2">
          Lancer ce test de vérification
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </section>

      {result.warnings.length > 0 && (
        <ul className="list-disc space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-4 pl-8 text-sm">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <details className="rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-base font-semibold">Hypothèses et méthode de calcul</summary>
        <div className="mt-4 space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {result.modelSummary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Hypothèse</th>
                  <th scope="col" className="px-3 py-2 font-medium">Valeur</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source</th>
                  <th scope="col" className="px-3 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.assumptions.map((a) => (
                  <tr key={a.key}>
                    <th scope="row" className="px-3 py-2 font-normal">{a.label}</th>
                    <td className="px-3 py-2 font-mono">{a.value}</td>
                    <td className="px-3 py-2 text-muted-foreground">{ASSUMPTION_SOURCES[a.source]}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}