import { formatDuration, formatInt } from "@/client/lib/format";
import type { ExecutorConfig, LoadScenario } from "@/shared/schemas";
import type { PublicConfig } from "@/shared/types/public-config";

export interface ScenarioPeaks {
  peakVus: number;
  durationSeconds: number;
  /** null quand le profil n'impose pas de cadence. */
  peakRps: number | null;
}

export function scenarioPeaks(executor: ExecutorConfig): ScenarioPeaks {
  const sum = (stages: Array<{ durationSeconds: number }>) => stages.reduce((t, s) => t + s.durationSeconds, 0);
  switch (executor.type) {
    case "constant-vus":
      return { peakVus: executor.vus, durationSeconds: executor.durationSeconds, peakRps: null };
    case "ramping-vus":
      return {
        peakVus: Math.max(executor.startVus, ...executor.stages.map((s) => s.target)),
        durationSeconds: sum(executor.stages),
        peakRps: null,
      };
    case "constant-arrival-rate":
      return {
        peakVus: executor.maxVus,
        durationSeconds: executor.durationSeconds,
        peakRps: executor.rate / executor.timeUnitSeconds,
      };
    case "ramping-arrival-rate":
      return {
        peakVus: executor.maxVus,
        durationSeconds: sum(executor.stages),
        peakRps: Math.max(executor.startRate, ...executor.stages.map((s) => s.target)) / executor.timeUnitSeconds,
      };
    default:
      return { peakVus: executor.vus, durationSeconds: executor.maxDurationSeconds, peakRps: null };
  }
}

/** Les dépassements des limites de l'instance, en phrases. Liste vide : le test peut partir. */
export function checkAgainstLimits(scenario: LoadScenario, limits: PublicConfig["limits"]): string[] {
  const peaks = scenarioPeaks(scenario.executor);
  const problems: string[] = [];
  if (peaks.peakVus > limits.load.maxVus) {
    problems.push(`${formatInt(peaks.peakVus)} utilisateurs virtuels demandés, ${formatInt(limits.load.maxVus)} autorisés.`);
  }
  if (peaks.durationSeconds > limits.load.maxDurationSeconds) {
    problems.push(
      `Durée de ${formatDuration(peaks.durationSeconds)} demandée, ${formatDuration(limits.load.maxDurationSeconds)} autorisées.`,
    );
  }
  if (peaks.peakRps !== null && peaks.peakRps > limits.load.maxRequestsPerSecond) {
    problems.push(
      `${formatInt(peaks.peakRps)} requêtes par seconde demandées, ${formatInt(limits.load.maxRequestsPerSecond)} autorisées.`,
    );
  }
  if (scenario.workflow.steps.length > limits.workflow.maxSteps) {
    problems.push(`${scenario.workflow.steps.length} étapes demandées, ${limits.workflow.maxSteps} autorisées.`);
  }
  return problems;
}