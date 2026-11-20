import type { StoredLoadResult } from "@/client/storage/db";
import { objectivesFromThresholds } from "@/client/features/load/verdict";
import {
  AssumptionsInputSchema,
  ObjectivesSchema,
  type ArchitectureConfig,
  type CapacityInput,
  type MeasuredRun,
} from "@/shared/schemas";
import { validateInfra, type InfraDraft } from "./infra";

export type CapacityMode = "measured" | "predictive";

export interface ObjectivesDraft {
  /** Le débit à absorber, en requêtes par seconde. */
  targetRps: number | null;
  p95MaxMs: number | null;
  maxErrorPercent: number;
  headroomPercent: number;
}

/** Hypothèses du mode avancé. null : laisser le modèle choisir. */
export interface AssumptionsDraft {
  scaleOutSerialPercent: number | null;
  serviceVariability: number | null;
  dbConnectionHeadroomPercent: number | null;
  avgResponseMs: number | null;
}

/** Une architecture à comparer à l'architecture actuelle. */
export interface ScenarioDraft {
  name: string;
  instances: number;
  vcpuPerInstance: number;
  ramGbPerInstance: number;
  poolSizePerInstance: number | null;
  dbMaxConnections: number | null;
}

export interface CapacityDraft {
  mode: CapacityMode;
  objectives: ObjectivesDraft;
  assumptions: AssumptionsDraft;
  extraScenarios: ScenarioDraft[];
  /** Mode « hypothèses » : le service n'a pas été mesuré. */
  predictive: { cpuMsPerRequest: number | null; baselineP95Ms: number | null };
}

export const MAX_SCENARIOS = 9; // + l'architecture actuelle = 10 configurations au plus

export const DEFAULT_CAPACITY: CapacityDraft = {
  mode: "measured",
  objectives: { targetRps: null, p95MaxMs: 300, maxErrorPercent: 1, headroomPercent: 30 },
  assumptions: { scaleOutSerialPercent: null, serviceVariability: null, dbConnectionHeadroomPercent: null, avgResponseMs: null },
  extraScenarios: [],
  predictive: { cpuMsPerRequest: null, baselineP95Ms: null },
};

export function newScenario(infra: InfraDraft, name = "Variante"): ScenarioDraft {
  return {
    name,
    instances: infra.instances * 2,
    vcpuPerInstance: infra.vcpuPerInstance,
    ramGbPerInstance: infra.ramGbPerInstance,
    poolSizePerInstance: infra.poolSizePerInstance,
    dbMaxConnections: infra.dbMaxConnections,
  };
}

/** Les objectifs déduits des critères de succès du test choisi. */
export function objectivesFromStored(stored: StoredLoadResult): Partial<ObjectivesDraft> {
  const { p95MaxMs, maxErrorRate } = objectivesFromThresholds(stored.scenario?.thresholds ?? []);
  return {
    ...(p95MaxMs !== undefined ? { p95MaxMs } : {}),
    ...(maxErrorRate !== undefined ? { maxErrorPercent: Number((maxErrorRate * 100).toFixed(4)) } : {}),
  };
}

const positive = (n: number | null) => n !== null && Number.isFinite(n) && n > 0;
const inRange = (n: number | null, min: number, max: number) => n === null || (Number.isFinite(n) && n >= min && n <= max);

export function validateCapacity(draft: CapacityDraft, infra: InfraDraft, context: { hasRun: boolean }): string[] {
  const problems: string[] = [...validateInfra(infra)];
  const { objectives, assumptions, extraScenarios, predictive } = draft;

  if (!positive(objectives.targetRps)) problems.push("Saisis le débit à absorber, en requêtes par seconde.");
  if (objectives.p95MaxMs !== null && !positive(objectives.p95MaxMs)) problems.push("La latence p95 visée doit être supérieure à 0 ms.");
  if (!inRange(objectives.maxErrorPercent, 0, 100)) problems.push("Le taux d'erreur acceptable doit être entre 0 et 100 %.");
  if (!inRange(objectives.headroomPercent, 0, 300)) problems.push("La marge de sécurité doit être entre 0 et 300 %.");

  if (draft.mode === "measured" && !context.hasRun) problems.push("Choisis un test mesuré, ou passe en mode « à partir d'hypothèses ».");
  if (draft.mode === "predictive") {
    if (!positive(predictive.cpuMsPerRequest)) problems.push("Saisis le temps de processeur consommé par requête (en ms).");
    if (!positive(predictive.baselineP95Ms)) problems.push("Saisis la latence p95 à faible charge (en ms).");
  }

  if (!inRange(assumptions.scaleOutSerialPercent, 0, 100)) problems.push("La part non parallélisable doit être entre 0 et 100 %.");
  if (!inRange(assumptions.serviceVariability, 0, 25)) problems.push("La variabilité du service doit être entre 0 et 25.");
  if (!inRange(assumptions.dbConnectionHeadroomPercent, 0, 90)) problems.push("La réserve de connexions de la base doit être entre 0 et 90 %.");
  if (assumptions.avgResponseMs !== null && !positive(assumptions.avgResponseMs)) problems.push("Le temps de réponse moyen doit être supérieur à 0 ms.");

  if (extraScenarios.length > MAX_SCENARIOS) problems.push(`${MAX_SCENARIOS} variantes au plus.`);
  extraScenarios.forEach((s, i) => {
    const name = s.name.trim() || `n° ${i + 1}`;
    if (s.name.trim() === "" || s.name.length > 100) problems.push(`Variante ${name} : donne-lui un nom (100 caractères au plus).`);
    for (const p of validateInfra(s)) problems.push(`Variante ${name} : ${p}`);
  });
  return problems;
}

const toArchitecture = (name: string, d: Omit<ScenarioDraft, "name">): ArchitectureConfig => ({
  name,
  instances: d.instances,
  vcpuPerInstance: d.vcpuPerInstance,
  ramGbPerInstance: d.ramGbPerInstance,
  ...(d.poolSizePerInstance !== null ? { poolSizePerInstance: d.poolSizePerInstance } : {}),
  ...(d.dbMaxConnections !== null ? { dbMaxConnections: d.dbMaxConnections } : {}),
});

/** Le corps attendu par `/api/advisor/capacity`. Appeler `validateCapacity` avant. */
export function buildCapacityInput(args: { draft: CapacityDraft; infra: InfraDraft; run: MeasuredRun | null }): CapacityInput {
  const { draft, infra, run } = args;
  const { objectives: o, assumptions: a } = draft;

  const objectives = ObjectivesSchema.parse({
    ...(o.targetRps !== null ? { targetRps: o.targetRps } : {}),
    ...(o.p95MaxMs !== null ? { p95MaxMs: o.p95MaxMs } : {}),
    maxErrorRate: o.maxErrorPercent / 100,
    headroomPercent: o.headroomPercent,
  });
  const assumptions = AssumptionsInputSchema.parse({
    ...(a.scaleOutSerialPercent !== null ? { scaleOutSerialFraction: a.scaleOutSerialPercent / 100 } : {}),
    ...(a.serviceVariability !== null ? { serviceVariability: a.serviceVariability } : {}),
    ...(a.dbConnectionHeadroomPercent !== null ? { dbConnectionHeadroom: a.dbConnectionHeadroomPercent / 100 } : {}),
    ...(a.avgResponseMs !== null ? { avgResponseMs: a.avgResponseMs } : {}),
  });

  const current = toArchitecture("Architecture actuelle", infra);
  const common = {
    objectives,
    assumptions,
    configs: [current, ...draft.extraScenarios.map((s) => toArchitecture(s.name.trim(), s))],
    baseline: current,
    sizingTemplate: {
      vcpuPerInstance: infra.vcpuPerInstance,
      ramGbPerInstance: infra.ramGbPerInstance,
      ...(infra.poolSizePerInstance !== null ? { poolSizePerInstance: infra.poolSizePerInstance } : {}),
      ...(infra.dbMaxConnections !== null ? { dbMaxConnections: infra.dbMaxConnections } : {}),
    },
  };

  if (draft.mode === "predictive") {
    return {
      mode: "predictive",
      service: { cpuMsPerRequest: draft.predictive.cpuMsPerRequest as number, baselineP95Ms: draft.predictive.baselineP95Ms as number },
      ...common,
    };
  }
  if (!run) throw new Error("Un test mesuré est nécessaire pour ce mode.");
  return { mode: "measured", runs: [run], referenceIndex: 0, ...common };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));

export function isCapacityDraft(value: unknown): value is CapacityDraft {
  if (!isObj(value) || !["measured", "predictive"].includes(value.mode as string)) return false;
  const { objectives: o, assumptions: a, predictive: p, extraScenarios } = value;
  return (
    isObj(o) && isNumOrNull(o.targetRps) && isNumOrNull(o.p95MaxMs) && typeof o.maxErrorPercent === "number" && typeof o.headroomPercent === "number" &&
    isObj(a) && isNumOrNull(a.scaleOutSerialPercent) && isNumOrNull(a.serviceVariability) && isNumOrNull(a.dbConnectionHeadroomPercent) && isNumOrNull(a.avgResponseMs) &&
    isObj(p) && isNumOrNull(p.cpuMsPerRequest) && isNumOrNull(p.baselineP95Ms) &&
    Array.isArray(extraScenarios) &&
    extraScenarios.every((s) => isObj(s) && typeof s.name === "string" && typeof s.instances === "number" && typeof s.vcpuPerInstance === "number" && typeof s.ramGbPerInstance === "number" && isNumOrNull(s.poolSizePerInstance) && isNumOrNull(s.dbMaxConnections))
  );
}