import "server-only";
import type { ExecutorConfig, LoadScenario, Workflow } from "@/shared/schemas";
import { AppError } from "@/server/utils/errors";
import type { Limits } from "./limits";

export function getPeakVus(e: ExecutorConfig): number {
  switch (e.type) {
    case "constant-vus":
    case "per-vu-iterations":
    case "shared-iterations":
      return e.vus;
    case "ramping-vus":
      return Math.max(e.startVus, ...e.stages.map((s) => s.target));
    case "constant-arrival-rate":
    case "ramping-arrival-rate":
      return e.maxVus;
  }
}

export function getTotalDurationSeconds(e: ExecutorConfig): number {
  switch (e.type) {
    case "constant-vus":
    case "constant-arrival-rate":
      return e.durationSeconds;
    case "ramping-vus":
    case "ramping-arrival-rate":
      return e.stages.reduce((sum, s) => sum + s.durationSeconds, 0);
    case "per-vu-iterations":
    case "shared-iterations":
      return e.maxDurationSeconds;
  }
}

/** Itérations par seconde pour les executors à cadence imposée, null sinon. */
export function getPeakIterationsPerSecond(e: ExecutorConfig): number | null {
  switch (e.type) {
    case "constant-arrival-rate":
      return e.rate / e.timeUnitSeconds;
    case "ramping-arrival-rate":
      return Math.max(e.startRate, ...e.stages.map((s) => s.target)) / e.timeUnitSeconds;
    default:
      return null;
  }
}

export function assertWorkflowWithinLimits(workflow: Workflow, limits: Limits): void {
  const violations: string[] = [];

  if (workflow.steps.length > limits.workflow.maxSteps) {
    violations.push(`Étapes : ${workflow.steps.length} > ${limits.workflow.maxSteps}`);
  }
  const pauseSeconds = workflow.steps.reduce((sum, s) => sum + s.thinkTimeMs, 0) / 1000;
  if (pauseSeconds > limits.workflow.maxDurationSeconds) {
    violations.push(`Pauses cumulées : ${pauseSeconds}s > ${limits.workflow.maxDurationSeconds}s`);
  }

  if (violations.length > 0) {
    throw new AppError("LIMIT_EXCEEDED", "Le workflow dépasse les limites du serveur.", { violations });
  }
}

export function assertScenarioWithinLimits(scenario: LoadScenario, limits: Limits): void {
  const violations: string[] = [];
  const steps = scenario.workflow.steps.length;
  const { executor } = scenario;

  if (steps > limits.workflow.maxSteps) {
    violations.push(`Étapes : ${steps} > ${limits.workflow.maxSteps}`);
  }

  const vus = getPeakVus(executor);
  if (vus > limits.load.maxVus) {
    violations.push(`VUs : ${vus} > ${limits.load.maxVus}`);
  }

  const duration = getTotalDurationSeconds(executor);
  if (duration > limits.load.maxDurationSeconds) {
    violations.push(`Durée : ${duration}s > ${limits.load.maxDurationSeconds}s`);
  }

  // Borne haute : chaque itération peut envoyer au plus une requête par étape.
  const iterationRate = getPeakIterationsPerSecond(executor);
  if (iterationRate !== null) {
    const rps = iterationRate * steps;
    if (rps > limits.load.maxRequestsPerSecond) {
      violations.push(`Débit : ${rps} req/s > ${limits.load.maxRequestsPerSecond} req/s`);
    }
  }

  if (violations.length > 0) {
    throw new AppError("LIMIT_EXCEEDED", "Le scénario dépasse les limites du serveur.", { violations });
  }
}

/** Vérifie un executor (sans workflow) contre les limites du serveur ; renvoie la liste des dépassements. */
export function checkExecutorAgainstLimits(executor: ExecutorConfig, requestsPerIteration: number, limits: Limits): string[] {
  const violations: string[] = [];

  const vus = getPeakVus(executor);
  if (vus > limits.load.maxVus) violations.push(`VUs : ${vus} > ${limits.load.maxVus}`);

  const duration = getTotalDurationSeconds(executor);
  if (duration > limits.load.maxDurationSeconds) {
    violations.push(`Durée : ${duration}s > ${limits.load.maxDurationSeconds}s`);
  }

  const iterationRate = getPeakIterationsPerSecond(executor);
  if (iterationRate !== null) {
    const rps = Math.round(iterationRate * requestsPerIteration * 10) / 10;
    if (rps > limits.load.maxRequestsPerSecond) {
      violations.push(`Débit : ${rps} req/s > ${limits.load.maxRequestsPerSecond} req/s`);
    }
  }
  return violations;
}