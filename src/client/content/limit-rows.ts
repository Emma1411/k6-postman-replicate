import type { GlossaryTerm } from "@/client/content/glossary";
import { formatBytes, formatDuration, formatInt } from "@/client/lib/format";
import type { PublicConfig } from "@/shared/types/public-config";

export interface LimitRow {
  label: string;
  value: string;
  /** Pourquoi cette limite existe. */
  why: string;
  term?: GlossaryTerm;
}

export function buildLimitRows(config: PublicConfig): LimitRow[] {
  const { limits } = config;
  return [
    {
      label: "Utilisateurs virtuels simultanés",
      value: formatInt(limits.load.maxVus),
      why: "Évite de saturer le processeur du serveur qui génère la charge.",
      term: "vu",
    },
    {
      label: "Durée d'un test de charge",
      value: formatDuration(limits.load.maxDurationSeconds),
      why: "Empêche un seul test d'occuper l'instance trop longtemps.",
    },
    {
      label: "Débit maximal",
      value: `${formatInt(limits.load.maxRequestsPerSecond)} req/s`,
      why: "Plafonne le trafic sortant de l'instance partagée.",
      term: "rps",
    },
    {
      label: "Tests de charge en parallèle",
      value: formatInt(limits.load.maxConcurrentRuns),
      why: "Un seul test à la fois, pour ne pas fausser les mesures.",
    },
    {
      label: "Tests de charge par heure",
      value: formatInt(limits.rateLimit.maxLoadRunsPerHour),
      why: "Évite les abus et les surcharges accidentelles.",
    },
    {
      label: "Appels à l'API",
      value: `${formatInt(limits.rateLimit.maxRequests)} par ${formatDuration(limits.rateLimit.windowSeconds)}`,
      why: "Protège l'instance contre les envois en rafale.",
    },
    {
      label: "Taille maximale d'une réponse",
      value: formatBytes(limits.http.maxResponseBytes),
      why: "Protège la mémoire du serveur.",
    },
    {
      label: "Délai maximal d'une requête",
      value: formatDuration(limits.http.maxTimeoutMs / 1000),
      why: "Libère rapidement les connexions bloquées.",
    },
    {
      label: "Étapes par scénario",
      value: formatInt(limits.workflow.maxSteps),
      why: "Garde les scénarios simples à exécuter.",
    },
  ];
}