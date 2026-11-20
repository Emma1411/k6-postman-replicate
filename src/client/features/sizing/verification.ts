import { checkAgainstLimits } from "@/client/features/load/scenario-limits";
import type { StoredLoadResult } from "@/client/storage/db";
import { LoadScenarioSchema, type LoadScenario } from "@/shared/schemas";
import type { VerificationPlan } from "@/shared/types/capacity-result";
import type { PublicConfig } from "@/shared/types/public-config";

export type VerificationOutcome =
  | { ok: true; scenario: LoadScenario; /** Ce qui empêche de lancer le test sur cette instance. */ blockers: string[] }
  | { ok: false; error: string };

/**
 * Le plan de vérification de l'Advisor, appliqué à la requête du test analysé :
 * même scénario, mais avec la charge et les seuils calculés pour l'objectif visé.
 */
export function buildVerificationScenario(
  stored: Pick<StoredLoadResult, "name" | "scenario">,
  plan: VerificationPlan,
  limits: PublicConfig["limits"] | null,
): VerificationOutcome {
  if (!stored.scenario) {
    return {
      ok: false,
      error: "Le scénario de ce test n'a pas été conservé. Relance-le depuis la page Test de charge pour obtenir un plan de vérification applicable.",
    };
  }
  const parsed = LoadScenarioSchema.safeParse({
    name: `Vérification : ${stored.name}`.slice(0, 200),
    workflow: stored.scenario.workflow,
    executor: plan.executor,
    thresholds: plan.thresholds,
  });
  if (!parsed.success) {
    return { ok: false, error: `Le plan de vérification n'est pas un scénario valide : ${parsed.error.issues[0]?.message ?? "erreur inconnue"}.` };
  }
  const fromServer = plan.withinServerLimits && !plan.withinServerLimits.ok ? plan.withinServerLimits.violations : [];
  const fromClient = limits ? checkAgainstLimits(parsed.data, limits) : [];
  return { ok: true, scenario: parsed.data, blockers: [...new Set([...fromServer, ...fromClient])] };
}