import type { GlossaryTerm } from "@/client/content/glossary";
import type { Timings } from "@/shared/schemas";

export type PhaseKey = "dns" | "connect" | "tls" | "ttfb" | "transfer";

export interface Phase {
  key: PhaseKey;
  label: string;
  term: GlossaryTerm;
  /** null : la phase n'a pas eu lieu (par exemple connexion réutilisée). */
  ms: number | null;
  /** Part du temps total, entre 0 et 1. */
  share: number | null;
}

export interface TimingBreakdown {
  totalMs: number;
  phases: Phase[];
  dominant: PhaseKey | null;
  /** Temps total non attribué à une phase. */
  unattributedMs: number;
}

const META: Record<PhaseKey, { label: string; term: GlossaryTerm; field: keyof Omit<Timings, "totalMs"> }> = {
  dns: { label: "Résolution DNS", term: "dns", field: "dnsMs" },
  connect: { label: "Connexion TCP", term: "connect", field: "connectMs" },
  tls: { label: "Négociation TLS", term: "tls", field: "tlsMs" },
  ttfb: { label: "Attente du serveur (TTFB)", term: "ttfb", field: "ttfbMs" },
  transfer: { label: "Transfert", term: "transfer", field: "transferMs" },
};

const ORDER: PhaseKey[] = ["dns", "connect", "tls", "ttfb", "transfer"];

export function breakdownTimings(timings: Timings): TimingBreakdown {
  const raw = ORDER.map((key) => ({ key, ms: timings[META[key].field] }));
  const known = raw.filter((e): e is { key: PhaseKey; ms: number } => e.ms !== null);
  const sum = known.reduce((total, e) => total + e.ms, 0);
  const denominator = Math.max(timings.totalMs, sum) || 1;

  let dominant: PhaseKey | null = null;
  let max = 0;
  for (const e of known) {
    if (e.ms > max) {
      max = e.ms;
      dominant = e.key;
    }
  }

  return {
    totalMs: timings.totalMs,
    phases: raw.map((e) => ({
      key: e.key,
      label: META[e.key].label,
      term: META[e.key].term,
      ms: e.ms,
      share: e.ms === null ? null : e.ms / denominator,
    })),
    dominant,
    unattributedMs: Math.max(0, timings.totalMs - sum),
  };
}

/** Conseils volontairement génériques : on ne connaît ni la technologie ni l'architecture de la cible. */
export const PHASE_ADVICE: Record<PhaseKey, { subject: string; text: string }> = {
  dns: {
    subject: "la résolution DNS",
    text: "Le temps est passé à trouver l'adresse du serveur. Il est souvent plus court aux appels suivants grâce aux caches. S'il reste élevé, regarde du côté du fournisseur DNS.",
  },
  connect: {
    subject: "la connexion TCP",
    text: "Le temps est passé à joindre le serveur (un aller-retour réseau). Réutiliser les connexions (keep-alive) ou rapprocher le serveur de ses utilisateurs réduit cette phase.",
  },
  tls: {
    subject: "la négociation TLS",
    text: "Le chiffrement de la connexion ne se paie qu'à son ouverture. Réutiliser les connexions et la reprise de session le réduisent.",
  },
  ttfb: {
    subject: "l'attente du serveur",
    text: "Le serveur a mis du temps à produire le premier octet de la réponse. Cette phase inclut son traitement (accès aux données, calcul, sérialisation) et un aller-retour réseau. Sous forte charge, c'est souvent la première à augmenter.",
  },
  transfer: {
    subject: "le transfert de la réponse",
    text: "Le téléchargement du corps de la réponse domine. Une réponse plus légère (compression, pagination, moins de champs) réduit cette phase.",
  },
};