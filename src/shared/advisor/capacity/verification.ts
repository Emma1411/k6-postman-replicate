import type { ArchitectureConfig, LoadScenario, Objectives, Threshold, Workflow } from "@/shared/schemas";
import { LoadScenarioSchema } from "@/shared/schemas";
import type { VerificationPlan } from "@/shared/types/capacity-result";

const plain = (n: number): string => String(Number(n.toFixed(6)));

/**
 * Plan de test pour vérifier une configuration : rampe jusqu'au débit cible, puis jusqu'au débit requis
 * (cible + marge), puis palier. Les thresholds reprennent les objectifs : si le test passe, la configuration
 * tient l'objectif avec sa marge.
 */
export function buildVerificationPlan(args: {
  config: ArchitectureConfig;
  objectives: Objectives;
  targetRps: number;
  requiredRps: number;
  baselineP95Ms: number | null;
  durationSeconds?: number;
}): VerificationPlan {
  const { objectives, targetRps, requiredRps } = args;
  const total = args.durationSeconds ?? 120;
  const perIteration = objectives.requestsPerIteration;

  // Les cadences du moteur sont en itérations par unité de temps : on passe à la minute pour les faibles débits.
  const peakIterationsPerSecond = requiredRps / perIteration;
  const unit = peakIterationsPerSecond < 20 ? 60 : 1;
  const rate = (rps: number) => Math.max(1, Math.round((rps / perIteration) * unit));

  const iterationSeconds = objectives.iterationSeconds ?? ((args.baselineP95Ms ?? 200) / 1000) * perIteration * 1.5;
  const concurrent = peakIterationsPerSecond * iterationSeconds;
  const preAllocatedVus = Math.max(1, Math.ceil(concurrent * 1.5));
  const maxVus = Math.max(preAllocatedVus, Math.ceil(concurrent * 4), 10);

  const first = Math.round(total * 0.3);
  const second = Math.round(total * 0.4);
  const executor: VerificationPlan["executor"] = {
    type: "ramping-arrival-rate",
    startRate: rate(targetRps * 0.25),
    timeUnitSeconds: unit,
    stages: [
      { durationSeconds: first, target: rate(targetRps) },
      { durationSeconds: second, target: rate(requiredRps) },
      { durationSeconds: total - first - second, target: rate(requiredRps) },
    ],
    preAllocatedVus,
    maxVus,
  };

  const thresholds: Threshold[] = [];
  if (objectives.p95MaxMs !== undefined) {
    thresholds.push({
      metric: "http_req_duration",
      expression: `p(95)<${plain(objectives.p95MaxMs)}`,
      abortOnFail: false,
      delayAbortEvalSeconds: 0,
    });
  }
  thresholds.push(
    { metric: "http_req_failed", expression: `rate<${plain(objectives.maxErrorRate)}`, abortOnFail: false, delayAbortEvalSeconds: 0 },
    { metric: "dropped_iterations", expression: "count==0", abortOnFail: false, delayAbortEvalSeconds: 0 },
  );

  return {
    executor,
    thresholds,
    expectedPeakRps: Math.round(requiredRps * 10) / 10,
    durationSeconds: total,
    notes: [
      `Le test monte jusqu'à ${Math.round(targetRps)} req/s (objectif), puis ${Math.round(requiredRps)} req/s (objectif avec ${objectives.headroomPercent} % de marge), et s'y maintient.`,
      "Les thresholds sont évalués sur l'ensemble du test : s'ils passent, l'objectif est tenu jusqu'au débit requis.",
      "Une itération abandonnée (dropped_iterations) signifie que la cadence demandée n'a pas été tenue : soit la configuration est insuffisante, soit le générateur est saturé (consulte le résumé du générateur).",
      `Prévu pour la configuration « ${args.config.name} » : déploie-la avant de lancer le test.`,
    ],
  };
}

/** Assemble le plan et le workflow de l'utilisateur en un scénario prêt pour le moteur de charge. */
export function buildVerificationScenario(plan: VerificationPlan, workflow: Workflow, name = "Vérification de capacité"): LoadScenario {
  return LoadScenarioSchema.parse({ name, workflow, executor: plan.executor, thresholds: plan.thresholds });
}