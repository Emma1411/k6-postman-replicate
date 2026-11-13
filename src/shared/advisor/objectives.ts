import type { Objectives } from "@/shared/schemas";

/** Débit visé en req/s : donné directement, ou déduit des utilisateurs simultanés (loi de Little). */
export function resolveTargetRps(o: Objectives): number | null {
  if (o.targetRps !== undefined) return o.targetRps;
  if (o.targetVus !== undefined && o.iterationSeconds !== undefined) {
    return (o.targetVus * o.requestsPerIteration) / o.iterationSeconds;
  }
  return null;
}

/** Débit à pouvoir absorber : l'objectif plus la marge de capacité. */
export function requiredRps(o: Objectives): number | null {
  const target = resolveTargetRps(o);
  return target === null ? null : target * (1 + o.headroomPercent / 100);
}