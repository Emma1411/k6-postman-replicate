import "server-only";
import { limits } from "@/server/config";
import { checkExecutorAgainstLimits } from "@/server/config/enforce-limits";
import { AppError } from "@/server/utils/errors";
import { analyzeRun } from "@/shared/advisor/analyze";
import { AdvisorInputError } from "@/shared/advisor/capacity/errors";
import { planCapacity } from "@/shared/advisor/capacity/plan";
import {
  normalizeAnalyzeInput,
  normalizeCapacityInput,
  type AnalyzeInput,
  type CapacityInput,
} from "@/shared/schemas";

export function analyzeController(input: AnalyzeInput): Response {
  return Response.json(analyzeRun(normalizeAnalyzeInput(input)));
}

export function capacityController(input: CapacityInput): Response {
  try {
    const result = planCapacity(normalizeCapacityInput(input));

    // Le plan de vérification est-il lançable sur ce serveur ? Sinon, on le dit tout de suite.
    const violations = checkExecutorAgainstLimits(result.verification.executor, result.target.requestsPerIteration, limits);
    result.verification.withinServerLimits = { ok: violations.length === 0, violations };

    return Response.json(result);
  } catch (err) {
    if (err instanceof AdvisorInputError) throw new AppError("VALIDATION_ERROR", err.message);
    throw err;
  }
}