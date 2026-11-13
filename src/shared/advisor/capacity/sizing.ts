import type { SizingTemplate } from "@/shared/schemas";
import type { ScenarioResult, SizingResult } from "@/shared/types/capacity-result";
import { round1 } from "../stats";
import { evaluateConfig, type EvalContext } from "./evaluate";
import { capacityAt, type ServiceModel } from "./model";

/**
 * Cherche le plus petit nombre d'instances qui passe tous les contrôles, pour une taille d'instance donnée.
 * Répond à « combien d'instances pour N utilisateurs ? » et à « à partir de quel débit en ajouter ? ».
 */
export function sizeInstances(
  template: SizingTemplate,
  model: ServiceModel,
  ctx: EvalContext,
  maxInstances = 500,
): SizingResult {
  const { objectives, policy } = ctx;
  const rhoMax = (objectives.cpuMaxPercent ?? policy.cpuWarnPercent) / 100;

  const databaseMaxInstances =
    template.poolSizePerInstance !== undefined && template.dbMaxConnections !== undefined
      ? Math.floor(Math.floor(template.dbMaxConnections * (1 - model.dbConnectionHeadroom)) / template.poolSizePerInstance)
      : null;
  const limit = Math.max(1, Math.min(maxInstances, databaseMaxInstances ?? maxInstances));

  let minimum: ScenarioResult | null = null;
  let recommended: ScenarioResult | null = null;
  let last: ScenarioResult | null = null;

  for (let n = 1; n <= limit; n++) {
    const result = evaluateConfig(
      { ...template, name: `${n} instance${n > 1 ? "s" : ""}`, instances: n },
      model,
      ctx,
    );
    last = result;
    if (minimum === null && (result.verdict === "ok" || result.verdict === "marginal")) minimum = result;
    if (result.verdict === "ok") {
      recommended = result;
      break;
    }
  }

  // Capacité maximale que l'ajout d'instances peut atteindre (tendance quand n devient très grand).
  const asymptote = capacityAt({ instances: 1e9, vcpuPerInstance: template.vcpuPerInstance }, model, rhoMax, "mid").rps;
  const scaleOutLimitRps = asymptote !== null && model.serialFraction > 0 ? round1(asymptote) : null;

  const size = `${template.vcpuPerInstance} vCPU / ${template.ramGbPerInstance} Go`;
  let explanation: string;
  if (recommended) {
    const n = recommended.config.instances;
    explanation = `Avec des instances de ${size}, ${n} instance${n > 1 ? "s" : ""} passent tous les contrôles, cas pessimiste compris.`;
    if (minimum && minimum.config.instances < n) {
      explanation += ` ${minimum.config.instances} instance${minimum.config.instances > 1 ? "s suffisent" : " suffit"} avec l'estimation centrale, sans marge d'incertitude.`;
    }
  } else if (minimum) {
    const n = minimum.config.instances;
    explanation = `Avec des instances de ${size}, ${n} instance${n > 1 ? "s suffisent" : " suffit"} avec l'estimation centrale, mais aucune configuration testée ne passe le cas pessimiste.`;
    if (databaseMaxInstances !== null && limit === databaseMaxInstances) {
      explanation += ` La limite de connexions de la base plafonne à ${databaseMaxInstances} instances : augmente-la, ou réduis la taille du pool par instance.`;
    }
  } else {
    const reached = last?.capacity.estimateRps ?? last?.capacity.lowRps ?? null;
    explanation = `Aucun nombre d'instances de ${size} ne tient l'objectif (${round1(ctx.requiredRps)} req/s requis)`;
    explanation += reached !== null ? ` : à ${last?.config.instances} instances, la capacité estimée est de ${round1(reached)} req/s.` : ".";
    if (scaleOutLimitRps !== null && scaleOutLimitRps < ctx.requiredRps) {
      explanation += ` Avec cette taille d'instance, la mise à l'échelle horizontale plafonne autour de ${scaleOutLimitRps} req/s quel que soit le nombre d'instances : il faut réduire la part de travail partagée ou augmenter la taille d'instance.`;
    } else if (databaseMaxInstances !== null && limit === databaseMaxInstances) {
      explanation += ` La limite de connexions de la base plafonne à ${databaseMaxInstances} instances.`;
    }
  }

  return {
    template: { vcpuPerInstance: template.vcpuPerInstance, ramGbPerInstance: template.ramGbPerInstance },
    minimumInstances: minimum?.config.instances ?? null,
    recommendedInstances: recommended?.config.instances ?? null,
    recommended,
    scaleOutLimitRps,
    databaseMaxInstances,
    explanation,
  };
}