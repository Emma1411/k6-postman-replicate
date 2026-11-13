import type { ArchitectureConfig } from "@/shared/schemas";
import { mmcQueue } from "./erlang";

export const DEFAULTS = {
  scaleOutSerialFraction: 0.05,
  serviceVariability: 1,
  dbConnectionHeadroom: 0.1,
  verticalExponent: 0.5,
  /** Incertitude relative sur le coût CPU quand il est saisi sans mesure. */
  cpuUncertaintyPredictive: 0.3,
} as const;

export type MemoryModel =
  | { kind: "inflight"; baseMb: number; perInflightMb: number; avgResponseMs: number }
  | { kind: "regression"; baseMb: number; mbPerRps: number }
  | { kind: "peak"; peakMb: number; peakRpsPerInstance: number };

export interface ServiceModel {
  /** Coût CPU d'une requête sur un vCPU, en ms ; null si inconnu. */
  cpuMsPerRequest: number | null;
  /** Incertitude relative sur ce coût (0,15 = ±15 %). */
  cpuUncertainty: number;
  /** p95 à faible charge, en ms. */
  baselineP95Ms: number | null;
  serialFraction: number;
  serviceVariability: number;
  dbConnectionHeadroom: number;
  memory: MemoryModel | null;
  /** Limite observée du test de référence, quand elle borne l'estimation (goulot hors CPU, ou pas de modèle CPU). */
  anchor: { lowRps: number; highRps: number; instances: number; vcpu: number } | null;
  verticalExponent: number;
  /** Facteur de prudence appliqué à l'estimation CPU quand le test de référence est plus bas que le modèle. */
  cpuCapacityFactor: number;
}

export type Variant = "low" | "mid" | "high";
type Sizing = Pick<ArchitectureConfig, "instances" | "vcpuPerInstance">;

/** Gain de n instances par rapport à une seule (Amdahl) : n / (1 + sf·(n − 1)). */
export const speedup = (n: number, serialFraction: number): number => n / (1 + serialFraction * (n - 1));

function exponentFor(e: number, variant: Variant): number {
  if (e <= 0 || e >= 1 || variant === "mid") return e;
  return variant === "low" ? Math.max(0, e - 0.25) : Math.min(1, e + 0.25);
}

/** Capacité estimée en req/s, dans le cas pessimiste (low), central (mid) ou optimiste (high). */
export function capacityAt(
  config: Sizing,
  model: ServiceModel,
  rhoMax: number,
  variant: Variant,
): { rps: number | null; limitedBy: "cpu" | "observed-bottleneck" | null } {
  const sf =
    variant === "low" ? Math.min(1, model.serialFraction * 2) : variant === "high" ? model.serialFraction / 2 : model.serialFraction;
  const gain = (n: number) => speedup(n, sf);

  let cpuCap: number | null = null;
  if (model.cpuMsPerRequest !== null) {
    const u = model.cpuUncertainty;
    const s = model.cpuMsPerRequest * (variant === "low" ? 1 + u : variant === "high" ? 1 - u : 1);
    cpuCap = ((rhoMax * config.vcpuPerInstance * 1000) / s) * gain(config.instances) * model.cpuCapacityFactor;
  }

  let anchorCap: number | null = null;
  if (model.anchor) {
    const a = model.anchor;
    const base = variant === "low" ? a.lowRps : variant === "high" ? a.highRps : (a.lowRps + a.highRps) / 2;
    const vertical = Math.pow(config.vcpuPerInstance / a.vcpu, exponentFor(model.verticalExponent, variant));
    anchorCap = base * (gain(config.instances) / gain(a.instances)) * vertical;
  }

  if (cpuCap === null && anchorCap === null) return { rps: null, limitedBy: null };
  if (cpuCap !== null && (anchorCap === null || cpuCap <= anchorCap)) return { rps: cpuCap, limitedBy: "cpu" };
  return { rps: anchorCap, limitedBy: "observed-bottleneck" };
}

export type LatencyEstimate = { p95Ms: number; utilization: number } | { unstable: true; utilization: number } | null;

/** p95 estimé à `rps` : p95 de base + quantile 95 de l'attente dans la file CPU de chaque instance. */
export function latencyAt(config: Sizing, model: ServiceModel, rps: number, pessimistic: boolean): LatencyEstimate {
  if (model.cpuMsPerRequest === null || model.baselineP95Ms === null) return null;

  const s = model.cpuMsPerRequest * (pessimistic ? 1 + model.cpuUncertainty : 1);
  // Les vCPU entiers sont des serveurs ; une fraction de vCPU rend les serveurs plus lents.
  const servers = Math.max(1, Math.floor(config.vcpuPerInstance));
  const serviceMs = (s * servers) / config.vcpuPerInstance;
  const queue = mmcQueue({
    servers,
    serviceMs,
    arrivalPerSec: rps / config.instances,
    variability: model.serviceVariability,
  });

  if (!queue.stable) return { unstable: true, utilization: queue.utilization };
  return { p95Ms: model.baselineP95Ms + queue.waitP95Ms, utilization: queue.utilization };
}

/** Mémoire estimée par instance (Mo) à `rps`, null si aucun modèle mémoire. */
export function memoryMbAt(config: Pick<ArchitectureConfig, "instances">, model: ServiceModel, rps: number): number | null {
  const m = model.memory;
  if (!m) return null;
  const perInstance = rps / config.instances;

  switch (m.kind) {
    case "inflight":
      return m.baseMb + m.perInflightMb * perInstance * (m.avgResponseMs / 1000);
    case "regression":
      return m.baseMb + m.mbPerRps * perInstance;
    case "peak":
      return m.peakMb * Math.max(1, perInstance / m.peakRpsPerInstance);
  }
}