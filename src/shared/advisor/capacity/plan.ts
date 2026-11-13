import type { ArchitectureConfig, InfraSpec, MeasuredRun, NormalizedCapacityInput, Objectives, Policy } from "@/shared/schemas";
import type { CapacityEvidence, Confidence } from "@/shared/types/advisor-result";
import type { Assumption, CapacityResult, ScenarioResult } from "@/shared/types/capacity-result";
import { detectShape, observedCapacity } from "../capacity-evidence";
import { requiredRps as requiredOf, resolveTargetRps } from "../objectives";
import { alignSeries, baselineP95, rolling } from "../series";
import { round1 } from "../stats";
import { calibrateCpuCost, calibrateMemory, calibrateSerialFraction } from "./calibrate";
import { AdvisorInputError } from "./errors";
import { evaluateConfig, type EvalContext } from "./evaluate";
import { capacityAt, DEFAULTS, type MemoryModel, type ServiceModel } from "./model";
import { sizeInstances } from "./sizing";
import { buildVerificationPlan } from "./verification";

function prepareRun(run: MeasuredRun, objectives: Objectives, policy: Policy) {
  const points = [...run.points].sort((a, b) => a.t - b.t);
  const roll = rolling(points);
  const shape = detectShape(roll);
  const aligned = alignSeries(points, run.infraMetrics?.samples ?? [], policy.maxAlignGapSeconds);
  return { aligned, capacity: observedCapacity(roll, shape, objectives), baseline: baselineP95(aligned, shape) };
}

const LEVELS: Confidence[] = ["low", "medium", "high"];
const lower = (c: Confidence): Confidence => LEVELS[Math.max(0, LEVELS.indexOf(c) - 1)];

const configFromInfra = (infra: InfraSpec, name: string): ArchitectureConfig => ({ ...infra, name });

const pctChange = (value: number | null, base: number | null): number | null =>
  value === null || base === null || base === 0 ? null : round1((value / base - 1) * 100);

/**
 * Capacity planning. Mode prédictif : le coût CPU par requête et le p95 de base sont saisis.
 * Mode mesuré : ils sont calibrés sur un test de référence, et la capacité observée borne les estimations.
 * Fonction pure : les mêmes entrées donnent toujours le même résultat.
 */
export function planCapacity(input: NormalizedCapacityInput): CapacityResult {
  const { objectives, policy, assumptions: a } = input;

  const targetRps = resolveTargetRps(objectives);
  if (targetRps === null) {
    throw new AdvisorInputError(
      "Précise un débit cible (targetRps), ou un nombre d'utilisateurs simultanés avec la durée d'une itération (targetVus et iterationSeconds).",
    );
  }
  const requiredRps = requiredOf(objectives) as number;
  const rhoMax = (objectives.cpuMaxPercent ?? policy.cpuWarnPercent) / 100;

  const assumptions: Assumption[] = [];
  const warnings: string[] = [];
  const modelSummary: string[] = [];
  const add = (key: string, label: string, value: string, source: Assumption["source"], note: string) =>
    assumptions.push({ key, label, value, source, note });

  const variability = a.serviceVariability ?? DEFAULTS.serviceVariability;
  const dbHeadroom = a.dbConnectionHeadroom ?? DEFAULTS.dbConnectionHeadroom;
  add(
    "serviceVariability",
    "Variabilité du temps de service",
    String(variability),
    a.serviceVariability !== undefined ? "user-provided" : "default",
    "Carré du coefficient de variation : 1 = temps de service exponentiel, 0 = constant. Une valeur plus faible donne des attentes plus courtes.",
  );
  add(
    "dbConnectionHeadroom",
    "Connexions de la base laissées libres",
    `${Math.round(dbHeadroom * 100)} %`,
    a.dbConnectionHeadroom !== undefined ? "user-provided" : "default",
    "Part de la limite de connexions réservée à l'administration, aux migrations et aux imprévus.",
  );
  add("headroomPercent", "Marge de capacité", `${objectives.headroomPercent} %`, "user-provided", "La capacité doit dépasser l'objectif de cette marge.");
  add("cpuMaxPercent", "Plafond d'utilisation CPU", `${round1(rhoMax * 100)} %`, objectives.cpuMaxPercent !== undefined ? "user-provided" : "default", "Utilisation CPU maximale que l'on accepte de planifier (par défaut : le seuil d'avertissement de la politique).");

  let model: ServiceModel;
  let observed: EvalContext["observed"] = null;
  let referenceConfig: ArchitectureConfig | null = null;
  let confidenceBase: Confidence = "low";

  if (input.mode === "predictive") {
    const serialFraction = a.scaleOutSerialFraction ?? DEFAULTS.scaleOutSerialFraction;
    const memory: MemoryModel | null =
      a.memoryBaseMb !== undefined && a.memoryPerInflightMb !== undefined
        ? {
            kind: "inflight",
            baseMb: a.memoryBaseMb,
            perInflightMb: a.memoryPerInflightMb,
            avgResponseMs: a.avgResponseMs ?? input.service.baselineP95Ms,
          }
        : null;

    model = {
      cpuMsPerRequest: input.service.cpuMsPerRequest,
      cpuUncertainty: DEFAULTS.cpuUncertaintyPredictive,
      baselineP95Ms: input.service.baselineP95Ms,
      serialFraction,
      serviceVariability: variability,
      dbConnectionHeadroom: dbHeadroom,
      memory,
      anchor: null,
      verticalExponent: a.verticalExponent ?? DEFAULTS.verticalExponent,
      cpuCapacityFactor: 1,
    };

    add("cpuMsPerRequest", "Coût CPU par requête", `${input.service.cpuMsPerRequest} ms`, "user-provided", `Saisi, non mesuré ici : incertitude supposée de ±${Math.round(DEFAULTS.cpuUncertaintyPredictive * 100)} %.`);
    add("baselineP95Ms", "p95 à faible charge", `${input.service.baselineP95Ms} ms`, "user-provided", "Latence sans file d'attente ; l'attente due à la charge s'y ajoute.");
    add("scaleOutSerialFraction", "Part de travail partagé (mise à l'échelle)", `${round1(serialFraction * 100)} %`, a.scaleOutSerialFraction !== undefined ? "user-provided" : "default", "Part du travail qui passe par une ressource partagée (base de données, cache…). Elle limite le gain de chaque instance ajoutée.");
    modelSummary.push("Mode prédictif : aucune mesure n'est utilisée. Les résultats ne valent que ce que valent les hypothèses ci-dessous ; vérifie-les par un test de charge.");
    if (memory === null) modelSummary.push("Aucun modèle mémoire : la mémoire n'est pas vérifiée.");
  } else {
    const ref = input.runs[input.referenceIndex];
    if (!ref) throw new AdvisorInputError(`Le test de référence n°${input.referenceIndex} n'existe pas (${input.runs.length} test(s) fournis).`);

    const prepared = input.runs.map((run) => ({ run, ...prepareRun(run, objectives, policy) }));
    const refPrepared = prepared[input.referenceIndex];
    referenceConfig = configFromInfra(ref.infra, "Test de référence (mesuré)");
    observed = { infra: ref.infra, capacity: refPrepared.capacity };

    // p95 de base
    const baselineP95Ms = input.overrides.baselineP95Ms ?? refPrepared.baseline;
    if (baselineP95Ms === null) warnings.push("Le p95 à faible charge n'a pas pu être déterminé : la latence n'est pas estimée. Saisis-le dans `overrides.baselineP95Ms`.");
    else
      add("baselineP95Ms", "p95 à faible charge", `${round1(baselineP95Ms)} ms`, input.overrides.baselineP95Ms !== undefined ? "user-provided" : "calibrated", "Médiane du p95 dans le quartile de plus faible charge du test de référence.");

    // coût CPU
    const cpuCalibration = input.overrides.cpuMsPerRequest === undefined ? calibrateCpuCost(ref, policy) : null;
    const cpuMs = input.overrides.cpuMsPerRequest ?? cpuCalibration?.cpuMsPerRequest ?? null;
    const cpuUncertainty = cpuCalibration?.uncertainty ?? DEFAULTS.cpuUncertaintyPredictive;
    if (input.overrides.cpuMsPerRequest !== undefined) {
      add("cpuMsPerRequest", "Coût CPU par requête", `${input.overrides.cpuMsPerRequest} ms`, "user-provided", "Saisi : remplace la calibration.");
    } else if (cpuCalibration) {
      add("cpuMsPerRequest", "Coût CPU par requête", `${round1(cpuCalibration.cpuMsPerRequest)} ms`, "calibrated", `Pente CPU % / débit sur ${cpuCalibration.points} points (corrélation ${round1(cpuCalibration.r * 100) / 100}) ; incertitude ±${Math.round(cpuUncertainty * 100)} %.`);
      modelSummary.push(`Coût CPU calibré : ${round1(cpuCalibration.cpuMsPerRequest)} ms par requête (corrélation ${round1(cpuCalibration.r * 100) / 100} sur ${cpuCalibration.points} points, CPU au repos ${round1(cpuCalibration.idlePercent)} %).`);
    } else {
      modelSummary.push("Le coût CPU par requête n'a pas pu être calibré (métriques CPU absentes, trop peu de points, ou CPU peu corrélé au débit) : la capacité s'appuie uniquement sur la limite observée.");
    }

    // fraction série
    const comparable = prepared
      .filter((p) => p.run.infra.vcpuPerInstance === ref.infra.vcpuPerInstance && p.run.infra.ramGbPerInstance === ref.infra.ramGbPerInstance)
      .map((p) => ({ instances: p.run.infra.instances, capacity: p.capacity }));
    const serialCalibration = a.scaleOutSerialFraction === undefined ? calibrateSerialFraction(comparable) : null;
    const serialFraction = a.scaleOutSerialFraction ?? serialCalibration?.value ?? DEFAULTS.scaleOutSerialFraction;
    add(
      "scaleOutSerialFraction",
      "Part de travail partagé (mise à l'échelle)",
      `${round1(serialFraction * 100)} %`,
      a.scaleOutSerialFraction !== undefined ? "user-provided" : serialCalibration ? "calibrated" : "default",
      serialCalibration
        ? `Déduite de la comparaison de tests : ${serialCalibration.basis}.`
        : "Valeur par défaut : fournis un second test avec un autre nombre d'instances pour la calibrer.",
    );

    // mémoire
    let memory: MemoryModel | null = null;
    if (a.memoryBaseMb !== undefined && a.memoryPerInflightMb !== undefined) {
      memory = { kind: "inflight", baseMb: a.memoryBaseMb, perInflightMb: a.memoryPerInflightMb, avgResponseMs: a.avgResponseMs ?? baselineP95Ms ?? 100 };
    } else {
      const calibration = calibrateMemory(ref, policy);
      if (calibration) {
        memory = calibration.model;
        add("memory", "Modèle mémoire", calibration.model.kind === "regression" ? "régression" : "pic observé", "calibrated", calibration.basis);
      } else {
        modelSummary.push("Pas de métriques mémoire : la mémoire n'est pas vérifiée.");
      }
    }

    // goulot : le CPU explique-t-il la limite observée ?
    let anchor: ServiceModel["anchor"] = null;
    let cpuCapacityFactor = 1;
    let verticalExponent = a.verticalExponent ?? DEFAULTS.verticalExponent;
    const evidence: CapacityEvidence = refPrepared.capacity;
    const bracket = evidence.kind === "bracketed" ? { low: evidence.sustainedRps as number, high: evidence.breachRps as number } : null;

    if (bracket && cpuMs !== null) {
      const cpuOnly: ServiceModel = {
        cpuMsPerRequest: cpuMs, cpuUncertainty, baselineP95Ms, serialFraction, serviceVariability: variability,
        dbConnectionHeadroom: dbHeadroom, memory: null, anchor: null, verticalExponent, cpuCapacityFactor: 1,
      };
      const modelCap = capacityAt(ref.infra, cpuOnly, rhoMax, "mid").rps as number;
      const observedMid = (bracket.low + bracket.high) / 2;
      const ratio = observedMid / modelCap;

      if (ratio < 0.7) {
        anchor = { lowRps: bracket.low, highRps: bracket.high, instances: ref.infra.instances, vcpu: ref.infra.vcpuPerInstance };
        verticalExponent = 0;
        modelSummary.push(`Le test de référence a atteint sa limite à ${round1(observedMid)} req/s, soit ${Math.round(ratio * 100)} % de ce que le CPU permettrait (${round1(modelCap)} req/s) : le goulot n'est probablement pas le CPU. Les estimations sont bornées par la limite observée et ajouter des vCPU n'augmente pas la capacité estimée.`);
        add("verticalExponent", "Gain d'une augmentation de vCPU", "0 (aucun)", "calibrated", "Le CPU n'est pas le facteur limitant dans le test de référence.");
      } else {
        cpuCapacityFactor = Math.min(1, ratio);
        modelSummary.push(`La limite observée (${round1(observedMid)} req/s) est cohérente avec le modèle CPU (${round1(modelCap)} req/s) : le CPU est le facteur limitant.${ratio < 1 ? ` Par prudence, l'estimation CPU est multipliée par ${round1(ratio * 100) / 100} pour coller à la mesure.` : ""}`);
      }
    } else if (bracket && cpuMs === null) {
      anchor = { lowRps: bracket.low, highRps: bracket.high, instances: ref.infra.instances, vcpu: ref.infra.vcpuPerInstance };
      add("verticalExponent", "Gain d'une augmentation de vCPU", String(verticalExponent), a.verticalExponent !== undefined ? "user-provided" : "default", "Goulot inconnu (pas de métriques CPU) : 0 = plus de vCPU n'aide pas, 1 = gain proportionnel.");
    } else {
      modelSummary.push(`Le test de référence n'a pas fourni de limite exacte (${evidence.basis}) : relance-le avec une rampe qui dépasse l'objectif pour des estimations plus fiables.`);
    }

    model = { cpuMsPerRequest: cpuMs, cpuUncertainty, baselineP95Ms, serialFraction, serviceVariability: variability, dbConnectionHeadroom: dbHeadroom, memory, anchor, verticalExponent, cpuCapacityFactor };
    confidenceBase = cpuCalibration && cpuCalibration.r >= 0.85 ? "medium" : "low";

    if (ref.generatorSaturated) {
      warnings.push("Le générateur du test de référence était saturé : les mesures (latence, capacité) sont peu fiables et la confiance est abaissée.");
      confidenceBase = lower(confidenceBase);
    }
    if (ref.infra.instances > 1 && ref.infraMetrics) {
      warnings.push("Les métriques CPU et mémoire sont des moyennes sur les instances : une instance saturée peut fausser la calibration.");
    }
  }

  const ctx: EvalContext = { objectives, policy, targetRps, requiredRps, observed, confidenceBase };
  const evaluate = (config: ArchitectureConfig): ScenarioResult => evaluateConfig(config, model, ctx);

  // Écart par rapport à la configuration actuelle (simulation avant déploiement).
  const baselineConfig = input.baseline ?? referenceConfig;
  const baseline = baselineConfig ? evaluate(baselineConfig) : null;
  const scenarios = input.configs.map((config) => {
    const result = evaluate(config);
    if (baseline) {
      const base = baseline.capacity.estimateRps ?? baseline.capacity.lowRps;
      const own = result.capacity.estimateRps ?? result.capacity.lowRps;
      result.vsBaseline = {
        capacityChangePercent: pctChange(own, base),
        p95ChangeMs:
          result.atTarget.p95Ms !== null && baseline.atTarget.p95Ms !== null ? round1(result.atTarget.p95Ms - baseline.atTarget.p95Ms) : null,
      };
    }
    return result;
  });

  // Choix : la plus petite configuration qui passe (vCPU, puis RAM, puis instances). Le coût n'est pas modélisé.
  const rank = (r: ScenarioResult) => [r.totals.vcpu, r.totals.ramGb, r.config.instances];
  const pick = (verdict: ScenarioResult["verdict"]) =>
    scenarios
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.verdict === verdict)
      .sort((x, y) => {
        const a1 = rank(x.s);
        const b1 = rank(y.s);
        return a1[0] - b1[0] || a1[1] - b1[1] || a1[2] - b1[2];
      })[0];
  const bestOk = pick("ok");
  const bestMarginal = bestOk ? undefined : pick("marginal");
  const best = bestOk
    ? { index: bestOk.index, reason: `« ${bestOk.s.name} » est la plus petite configuration qui passe tous les contrôles, cas pessimiste compris (classement par total de vCPU puis de RAM : le coût n'est pas modélisé).` }
    : bestMarginal
      ? { index: bestMarginal.index, reason: `Aucune configuration ne passe le cas pessimiste. « ${bestMarginal.s.name} » est la plus petite dont l'estimation centrale tient l'objectif : à valider par un test de charge.` }
      : null;

  const template = input.sizingTemplate ?? input.configs[0];
  const sizing = sizeInstances(template, model, ctx);

  const verifyConfig =
    (best ? scenarios[best.index].config : null) ??
    sizing.recommended?.config ??
    input.configs[0];
  const verification = buildVerificationPlan({
    config: verifyConfig,
    objectives,
    targetRps,
    requiredRps,
    baselineP95Ms: model.baselineP95Ms,
  });

  return {
    advisoryOnly: true,
    mode: input.mode,
    target: {
      targetRps: round1(targetRps),
      requiredRps: round1(requiredRps),
      requestsPerIteration: objectives.requestsPerIteration,
      p95MaxMs: objectives.p95MaxMs ?? null,
      headroomPercent: objectives.headroomPercent,
    },
    modelSummary,
    assumptions,
    baseline,
    scenarios,
    best,
    sizing,
    verification,
    warnings,
  };
}