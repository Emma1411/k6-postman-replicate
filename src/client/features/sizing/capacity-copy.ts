import type { Tone } from "@/client/features/load/verdict";
import { formatDuration, formatInt } from "@/client/lib/format";
import type { CheckStatus, LimitedBy, ScenarioResult, SizingResult, VerificationPlan, Verdict } from "@/shared/types/capacity-result";

export const VERDICT_COPY: Record<Verdict, { label: string; tone: Tone; text: string }> = {
  ok: { label: "OK", tone: "success", text: "Cette architecture absorbe la charge visée, avec la marge de sécurité demandée." },
  marginal: { label: "Marginal", tone: "warning", text: "Cette architecture absorbe la charge visée, mais de justesse : un contrôle est en alerte ou la marge n'est pas tenue." },
  insufficient: { label: "Insuffisant", tone: "danger", text: "Cette architecture ne suffit pas pour la charge visée." },
  undetermined: { label: "Indéterminé", tone: "neutral", text: "Les données ne permettent pas de conclure pour cette architecture." },
};

export const CHECK_LABELS = { capacity: "Capacité", latency: "Latence", memory: "Mémoire", database: "Base de données" } as const;

export const CHECK_COPY: Record<CheckStatus, { label: string; tone: Tone }> = {
  ok: { label: "Réussi", tone: "success" },
  marginal: { label: "Alerte", tone: "warning" },
  fail: { label: "Échec", tone: "danger" },
  unknown: { label: "Inconnu", tone: "neutral" },
};

export const ASSUMPTION_SOURCES = {
  default: "Valeur par défaut",
  "user-provided": "Fournie par toi",
  calibrated: "Calibrée sur ton test",
} as const;

export function limitedByLabel(limitedBy: LimitedBy): string | null {
  switch (limitedBy) {
    case "cpu":
      return "Limitée par le processeur";
    case "observed-bottleneck":
      return "Limitée par un goulot observé pendant le test";
    case "observed":
      return "Capacité observée pendant le test";
    default:
      return null;
  }
}

const plural = (n: number, word: string) => `${formatInt(n)} ${word}${n > 1 ? "s" : ""}`;

export const formatRps = (n: number | null): string => (n === null ? "—" : `${formatInt(Math.round(n))} req/s`);

/** « 286 req/s (entre 150 et 571) », ou null si la capacité n'a pas pu être estimée. */
export function capacityBand(s: ScenarioResult): string | null {
  const { estimateRps, lowRps, highRps } = s.capacity;
  if (estimateRps === null) return null;
  return lowRps !== null && highRps !== null
    ? `${formatRps(estimateRps)} (entre ${formatInt(Math.round(lowRps))} et ${formatInt(Math.round(highRps))})`
    : formatRps(estimateRps);
}

/** Le dimensionnement recommandé, en phrases. */
export function describeSizing(sizing: SizingResult, target: { targetRps: number; requiredRps: number; headroomPercent: number }): string[] {
  const out: string[] = [];
  if (sizing.minimumInstances !== null && sizing.recommendedInstances !== null) {
    out.push(`Il faut au moins ${plural(sizing.minimumInstances, "instance")} pour absorber ${formatRps(target.targetRps)}.`);
    out.push(
      `${plural(sizing.recommendedInstances, "instance")} sont recommandées pour tenir ${formatRps(target.requiredRps)}, soit la charge visée avec ${formatInt(target.headroomPercent)} % de marge.`,
    );
  } else {
    out.push("Le nombre d'instances n'a pas pu être déterminé avec ces données.");
  }
  if (sizing.scaleOutLimitRps !== null) {
    out.push(`Même avec un très grand nombre d'instances, la part non parallélisable du service plafonne le débit autour de ${formatRps(sizing.scaleOutLimitRps)}.`);
  }
  if (sizing.databaseMaxInstances !== null) {
    out.push(`La base de données limite le service à ${plural(sizing.databaseMaxInstances, "instance")} avec le pool de connexions actuel.`);
  }
  return out;
}

export const verificationSummary = (plan: Pick<VerificationPlan, "durationSeconds" | "expectedPeakRps">): string =>
  `${formatDuration(plan.durationSeconds)} · pic attendu ${formatRps(plan.expectedPeakRps)}`;