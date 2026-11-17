"use client";

import { Explain } from "@/client/components/explain";
import { Badge } from "@/client/components/ui/badge";
import { cn } from "@/client/lib/utils";
import type { Timings } from "@/shared/schemas";
import { PHASE_ADVICE, breakdownTimings, type PhaseKey } from "../timing";

const COLORS: Record<PhaseKey, string> = {
  dns: "#bfdbfe",
  connect: "#60a5fa",
  tls: "#1d4ed8",
  ttfb: "#38bdf8",
  transfer: "#3fb68b",
};

const ABSENT: Partial<Record<PhaseKey, string>> = {
  dns: "Adresse déjà connue",
  connect: "Connexion réutilisée",
  tls: "Pas de HTTPS ou connexion réutilisée",
};

const pct = (share: number) => `${(share * 100).toFixed(1).replace(".", ",")} %`;

export function TimingBreakdown({ timings }: { timings: Timings }) {
  const b = breakdownTimings(timings);
  const dominant = b.phases.find((p) => p.key === b.dominant);
  const summary = b.phases
    .filter((p) => p.ms !== null)
    .map((p) => `${p.label} ${p.ms} ms`)
    .join(", ");

  return (
    <section aria-labelledby="timing-title" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="timing-title" className="text-base font-semibold">
          Décomposition du temps ({b.totalMs} ms)
        </h2>
        <Badge variant="secondary">Mesuré</Badge>
      </div>

      <div role="img" aria-label={`Décomposition : ${summary}`} className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {b.phases.map((p) =>
          p.share && p.share > 0 ? (
            <div key={p.key} style={{ width: `${p.share * 100}%`, backgroundColor: COLORS[p.key] }} title={`${p.label} : ${p.ms} ms`} />
          ) : null,
        )}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {b.phases.map((p) => (
          <li
            key={p.key}
            className={cn("rounded-lg border border-border bg-background/40 p-3", p.key === b.dominant && "border-primary/60 bg-primary/5")}
          >
            <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: COLORS[p.key] }} />
                {p.label}
              </span>
              <Explain term={p.term} />
            </div>
            {p.ms === null ? (
              <>
                <p className="mt-1 text-lg font-medium text-muted-foreground">—</p>
                <p className="text-xs text-muted-foreground">{ABSENT[p.key] ?? "Non mesuré"}</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-lg font-medium tabular-nums">{p.ms} ms</p>
                <p className="text-xs text-muted-foreground tabular-nums">{p.share !== null ? pct(p.share) : ""}</p>
              </>
            )}
            {p.key === b.dominant && <Badge className="mt-2" variant="outline">Phase dominante</Badge>}
          </li>
        ))}
      </ul>

      {b.unattributedMs > 0 && (
        <p className="text-xs text-muted-foreground">{b.unattributedMs} ms du temps total ne sont rattachés à aucune phase.</p>
      )}

      {dominant && dominant.ms !== null && dominant.share !== null && b.dominant && (
        <div className="rounded-lg bg-muted p-4">
          <h3 className="text-sm font-medium">Pourquoi {PHASE_ADVICE[b.dominant].subject} compte le plus ici ?</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Cette phase représente {pct(dominant.share)} du temps total ({dominant.ms} ms sur {b.totalMs} ms). {PHASE_ADVICE[b.dominant].text}
          </p>
        </div>
      )}
    </section>
  );
}