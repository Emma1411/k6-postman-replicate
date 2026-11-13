import type { ArchitectureConfig, InfraSpec, Objectives, Policy } from "@/shared/schemas";
import type { CapacityEvidence, Confidence } from "@/shared/types/advisor-result";
import type { Check, ScenarioResult } from "@/shared/types/capacity-result";
import { round1 } from "../stats";
import { capacityAt, latencyAt, memoryMbAt, type ServiceModel } from "./model";

export interface EvalContext {
  objectives: Objectives;
  policy: Policy;
  targetRps: number;
  requiredRps: number;
  /** Test de référence mesuré : sa propre configuration est évaluée d'après la mesure, pas le modèle. */
  observed: { infra: InfraSpec; capacity: CapacityEvidence } | null;
  confidenceBase: Confidence;
}

interface CapacityRange {
  estimateRps: number | null;
  lowRps: number | null;
  highRps: number | null;
  limitedBy: ScenarioResult["capacity"]["limitedBy"];
}

const sameInfra = (a: ArchitectureConfig, b: InfraSpec): boolean =>
  a.instances === b.instances && a.vcpuPerInstance === b.vcpuPerInstance && a.ramGbPerInstance === b.ramGbPerInstance;

function fromEvidence(e: CapacityEvidence): CapacityRange {
  switch (e.kind) {
    case "bracketed":
      return {
        estimateRps: ((e.sustainedRps as number) + (e.breachRps as number)) / 2,
        lowRps: e.sustainedRps,
        highRps: e.breachRps,
        limitedBy: "observed",
      };
    case "lower-bound":
      return { estimateRps: null, lowRps: e.sustainedRps, highRps: null, limitedBy: "observed" };
    case "upper-bound":
      return { estimateRps: null, lowRps: null, highRps: e.breachRps, limitedBy: "observed" };
    case "unknown":
      return { estimateRps: null, lowRps: null, highRps: null, limitedBy: null };
  }
}

function capacityCheck(cap: CapacityRange, required: number): Check {
  const { lowRps: low, estimateRps: est, highRps: high } = cap;
  const range = `${low !== null ? round1(low) : "?"} à ${high !== null ? round1(high) : "?"} req/s`;

  if (low === null && est === null && high === null) {
    return { status: "unknown", detail: "Capacité non estimable : fournis un coût CPU par requête ou un test mesuré qui atteint sa limite." };
  }
  if (low !== null && low >= required) {
    return { status: "ok", detail: `Capacité d'au moins ${round1(low)} req/s, même dans le cas pessimiste (requis : ${round1(required)} req/s).` };
  }
  if (high !== null && high < required) {
    return { status: "fail", detail: `Capacité de ${range} au mieux, sous les ${round1(required)} req/s requis.` };
  }
  if (est !== null && est >= required) {
    return { status: "marginal", detail: `Estimation centrale de ${round1(est)} req/s au-dessus du requis (${round1(required)}), mais le cas pessimiste (${low !== null ? round1(low) : "?"} req/s) ne suffit pas.` };
  }
  if (est !== null) {
    return { status: "fail", detail: `Estimation centrale de ${round1(est)} req/s sous les ${round1(required)} req/s requis (fourchette ${range}).` };
  }
  return { status: "unknown", detail: `La limite n'a pas été atteinte pendant le test : la capacité est d'au moins ${low !== null ? round1(low) : "?"} req/s, sans que l'on sache si elle atteint ${round1(required)} req/s.` };
}

export function evaluateConfig(config: ArchitectureConfig, model: ServiceModel, ctx: EvalContext): ScenarioResult {
  const { objectives, policy, targetRps, requiredRps } = ctx;
  const rhoMax = (objectives.cpuMaxPercent ?? policy.cpuWarnPercent) / 100;
  const ramMax = objectives.ramMaxPercent ?? policy.ramWarnPercent;
  const notes: string[] = [];
  const isReference = ctx.observed !== null && sameInfra(config, ctx.observed.infra);

  // --- Capacité ---
  let cap: CapacityRange;
  if (isReference && ctx.observed) {
    cap = fromEvidence(ctx.observed.capacity);
    notes.push("Configuration du test de référence : la capacité vient de la mesure, pas du modèle.");
  } else {
    const low = capacityAt(config, model, rhoMax, "low");
    const mid = capacityAt(config, model, rhoMax, "mid");
    const high = capacityAt(config, model, rhoMax, "high");
    cap = { estimateRps: mid.rps, lowRps: low.rps, highRps: high.rps, limitedBy: mid.limitedBy };
  }
  const capacity = capacityCheck(cap, requiredRps);
  const sustainable = cap.estimateRps ?? cap.lowRps;
  if (cap.limitedBy === "observed-bottleneck") {
    notes.push("Le goulot observé n'est pas le CPU : plus de vCPU n'augmente pas (ou peu) la capacité estimée.");
  }

  // --- Latence ---
  const mid = latencyAt(config, model, targetRps, false);
  const pess = latencyAt(config, model, targetRps, true);
  const slo = objectives.p95MaxMs;
  let latency: Check;
  if (mid === null) {
    latency = { status: "unknown", detail: "Pas de modèle de latence (coût CPU par requête ou p95 de base manquant)." };
  } else if ("unstable" in mid) {
    latency = { status: "fail", detail: `À ${round1(targetRps)} req/s, les instances saturent (utilisation ${round1(mid.utilization * 100)} %) : la file d'attente n'est pas bornée.` };
  } else if (slo === undefined) {
    latency = { status: "unknown", detail: `p95 estimé à ${round1(mid.p95Ms)} ms ; aucun objectif de p95 défini.` };
  } else {
    const pessOk = pess !== null && !("unstable" in pess) && pess.p95Ms <= slo;
    if (mid.p95Ms > slo) {
      latency = { status: "fail", detail: `p95 estimé à ${round1(mid.p95Ms)} ms, au-dessus de l'objectif (${slo} ms).` };
    } else if (!pessOk) {
      latency = { status: "marginal", detail: `p95 estimé à ${round1(mid.p95Ms)} ms (objectif ${slo} ms) mais le cas pessimiste ne tient pas.` };
    } else {
      latency = { status: "ok", detail: `p95 estimé à ${round1(mid.p95Ms)} ms, sous l'objectif (${slo} ms), cas pessimiste compris.` };
    }
  }

  // --- Mémoire ---
  const ramMb = config.ramGbPerInstance * 1024;
  const memMb = memoryMbAt(config, model, targetRps);
  const memoryPercent = memMb === null ? null : (memMb / ramMb) * 100;
  const memory: Check =
    memoryPercent === null
      ? { status: "unknown", detail: "Pas de modèle mémoire : fournis la mémoire de base et par requête en cours, ou un test avec les métriques mémoire." }
      : memoryPercent > ramMax
        ? { status: "fail", detail: `Mémoire estimée à ${round1(memoryPercent)} % de ${config.ramGbPerInstance} Go par instance, au-dessus du plafond (${ramMax} %).` }
        : { status: "ok", detail: `Mémoire estimée à ${round1(memoryPercent)} % de ${config.ramGbPerInstance} Go par instance (plafond ${ramMax} %).` };

  // --- Base de données : arithmétique exacte, pas une estimation ---
  let database: Check;
  let totalConnections: number | null = null;
  if (config.poolSizePerInstance === undefined || config.dbMaxConnections === undefined) {
    database = { status: "unknown", detail: "Taille du pool par instance ou limite de connexions de la base non renseignée." };
  } else {
    totalConnections = config.instances * config.poolSizePerInstance;
    const allowed = Math.floor(config.dbMaxConnections * (1 - model.dbConnectionHeadroom));
    database =
      totalConnections <= allowed
        ? { status: "ok", detail: `${config.instances} × ${config.poolSizePerInstance} = ${totalConnections} connexions, sous la limite utilisable (${allowed} sur ${config.dbMaxConnections}).` }
        : { status: "fail", detail: `${config.instances} × ${config.poolSizePerInstance} = ${totalConnections} connexions, au-dessus de la limite utilisable (${allowed} sur ${config.dbMaxConnections}).` };
  }

  const checks = { capacity, latency, memory, database };
  const statuses = Object.values(checks).map((c) => c.status);
  const verdict: ScenarioResult["verdict"] = statuses.includes("fail")
    ? "insufficient"
    : capacity.status === "unknown"
      ? "undetermined"
      : statuses.includes("marginal")
        ? "marginal"
        : "ok";

  const unchecked = (Object.entries(checks) as Array<[string, Check]>)
    .filter(([name, c]) => c.status === "unknown" && name !== "capacity")
    .map(([name]) => ({ latency: "latence", memory: "mémoire", database: "connexions de la base" })[name] as string);

  const confidence: Confidence = isReference && ctx.observed?.capacity.kind === "bracketed" ? "high" : ctx.confidenceBase;
  const hasUtilization = mid !== null;

  return {
    name: config.name,
    config,
    isReference,
    totals: { vcpu: config.instances * config.vcpuPerInstance, ramGb: config.instances * config.ramGbPerInstance },
    capacity: {
      ...cap,
      maxTargetRps: sustainable === null ? null : round1(sustainable / (1 + objectives.headroomPercent / 100)),
    },
    atTarget: {
      cpuUtilizationPercent: hasUtilization ? round1(mid.utilization * 100) : null,
      p95Ms: mid !== null && !("unstable" in mid) ? round1(mid.p95Ms) : null,
      p95PessimisticMs: pess !== null && !("unstable" in pess) ? round1(pess.p95Ms) : null,
      memoryPercent: memoryPercent === null ? null : round1(memoryPercent),
      databaseConnections: totalConnections,
    },
    checks,
    verdict,
    confidence,
    unchecked,
    notes,
    vsBaseline: null,
  };
}