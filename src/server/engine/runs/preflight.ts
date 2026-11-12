import "server-only";
import type { Limits } from "@/server/config/limits";
import { assertUrlAllowed } from "@/server/middlewares/ssrf-guard";
import { interpolateString } from "@/server/services/http-executor/interpolate";
import type { LoadScenario } from "@/shared/schemas";

/**
 * Refuse tout de suite un scénario dont une URL est déjà connue comme interdite,
 * plutôt que de lancer un test où 100 % des requêtes échoueraient.
 * Les URLs construites à l'exécution (variables extraites) sont contrôlées au moment de l'envoi.
 */
export function preflightScenario(scenario: LoadScenario, limits: Limits): void {
  for (const step of scenario.workflow.steps) {
    const unresolved = new Set<string>();
    const url = interpolateString(step.request.url, scenario.workflow.variables, unresolved);
    if (unresolved.size === 0) assertUrlAllowed(url, limits);
  }
}