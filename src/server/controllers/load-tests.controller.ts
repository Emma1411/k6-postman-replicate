import "server-only";
import { limits } from "@/server/config";
import { assertScenarioWithinLimits } from "@/server/config/enforce-limits";
import { preflightScenario } from "@/server/engine/runs/preflight";
import { getRegistry } from "@/server/engine/runs/run-registry";
import { sseResponse } from "@/server/engine/runs/sse";
import { parseThresholds } from "@/server/engine/thresholds/thresholds";
import type { RunLoadTestInput } from "@/shared/schemas";

/** Valide le scénario, lance le test et renvoie le flux SSE (le premier événement contient le runId). */
export function startLoadTestController(input: RunLoadTestInput, signal: AbortSignal): Response {
  const { scenario } = input;
  assertScenarioWithinLimits(scenario, limits);
  parseThresholds(scenario.thresholds);
  preflightScenario(scenario, limits);

  const run = getRegistry().create(scenario);
  return sseResponse(run, signal);
}

/** Rattache un client à un test en cours ou terminé (après un rechargement de page, par exemple). */
export function attachLoadTestController(runId: string, signal: AbortSignal): Response {
  return sseResponse(getRegistry().get(runId), signal);
}

export function getLoadTestController(runId: string): Response {
  return Response.json(getRegistry().get(runId).initEvent());
}

export function cancelLoadTestController(runId: string): Response {
  const run = getRegistry().get(runId);
  run.cancel("Annulé par l'utilisateur.", "cancelled");
  return Response.json({ runId, state: run.info().state }, { status: 202 });
}