import { Badge } from "@/client/components/ui/badge";

const LABELS = { measured: "Mesuré", estimated: "Estimé · indicatif", user: "Fourni par toi" } as const;
export type ProvenanceKind = keyof typeof LABELS;

/** D'où vient un chiffre : mesuré pendant le test, estimé par un modèle, ou saisi par l'utilisateur. */
export function ProvenanceBadge({ kind }: { kind: ProvenanceKind }) {
  return (
    <Badge variant="secondary" className="shrink-0 font-mono text-[10px] uppercase">
      {LABELS[kind]}
    </Badge>
  );
}