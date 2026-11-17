import type { ReactNode } from "react";
import { Explain } from "@/client/components/explain";
import { ProvenanceBadge, type ProvenanceKind } from "@/client/components/provenance-badge";
import type { GlossaryTerm } from "@/client/content/glossary";
import { cn } from "@/client/lib/utils";

export type KpiTone = "default" | "success" | "warning" | "danger";

const TONES: Record<KpiTone, string> = {
  default: "border-t-border",
  success: "border-t-success",
  warning: "border-t-warning",
  danger: "border-t-destructive",
};

interface Props {
  label: string;
  term?: GlossaryTerm;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  provenance?: ProvenanceKind;
  tone?: KpiTone;
}

export function KpiCard({ label, term, value, unit, hint, provenance, tone = "default" }: Props) {
  return (
    <div className={cn("rounded-xl border border-t-2 border-border bg-card p-4", TONES[tone])}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          {label}
          {term && <Explain term={term} />}
        </p>
        {provenance && <ProvenanceBadge kind={provenance} />}
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </p>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}