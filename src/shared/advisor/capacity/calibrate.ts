import type { MeasuredRun, Policy } from "@/shared/schemas";
import type { CapacityEvidence } from "@/shared/types/advisor-result";
import { alignSeries } from "../series";
import { linearRegression, round1 } from "../stats";
import type { MemoryModel } from "./model";

export interface CpuCalibration {
  cpuMsPerRequest: number;
  /** Incertitude relative (environ 95 %), bornée entre 10 et 50 %. */
  uncertainty: number;
  r: number;
  points: number;
  idlePercent: number;
}

/**
 * Coût CPU par requête, déduit de la pente CPU % en fonction du débit.
 * Avec cpu% = repos + pente × débit et pente = 100·s / (instances · vCPU · 1000), on a s = pente · instances · vCPU · 10.
 * Les points saturés sont écartés : un CPU plafonné fausserait la pente.
 */
export function calibrateCpuCost(run: MeasuredRun, policy: Policy): CpuCalibration | null {
  const aligned = alignSeries(run.points, run.infraMetrics?.samples ?? [], policy.maxAlignGapSeconds);
  const usable = aligned.filter((p) => p.cpu !== null && p.rps > 0 && p.cpu < policy.cpuSaturationPercent);
  if (usable.length < 10) return null;

  const reg = linearRegression(
    usable.map((p) => p.rps),
    usable.map((p) => p.cpu as number),
  );
  if (!reg || reg.slope <= 0 || reg.r < 0.7) return null;

  const { instances, vcpuPerInstance } = run.infra;
  return {
    cpuMsPerRequest: reg.slope * instances * vcpuPerInstance * 10,
    uncertainty: Math.min(0.5, Math.max(0.1, (2 * reg.slopeStdErr) / reg.slope)),
    r: reg.r,
    points: usable.length,
    idlePercent: reg.intercept,
  };
}

export interface MemoryCalibration {
  model: MemoryModel;
  basis: string;
}

/** Modèle mémoire par instance : régression Mo / débit par instance si elle est nette, sinon pic observé (prudent). */
export function calibrateMemory(run: MeasuredRun, policy: Policy): MemoryCalibration | null {
  const aligned = alignSeries(run.points, run.infraMetrics?.samples ?? [], policy.maxAlignGapSeconds);
  const ramMb = run.infra.ramGbPerInstance * 1024;
  const usable = aligned.filter((p) => p.mem !== null && p.rps > 0);
  if (usable.length < 3) return null;

  const xs = usable.map((p) => p.rps / run.infra.instances);
  const ys = usable.map((p) => ((p.mem as number) / 100) * ramMb);

  if (usable.length >= 10) {
    const reg = linearRegression(xs, ys);
    if (reg && reg.r >= 0.5 && reg.slope >= 0) {
      return {
        model: { kind: "regression", baseMb: Math.max(0, reg.intercept), mbPerRps: reg.slope },
        basis: `régression sur ${usable.length} points (corrélation ${round1(reg.r * 100) / 100}) : ${Math.round(Math.max(0, reg.intercept))} Mo de base + ${round1(reg.slope)} Mo par req/s et par instance`,
      };
    }
  }

  const peakMb = Math.max(...ys);
  const peakRps = Math.max(...xs);
  return {
    model: { kind: "peak", peakMb, peakRpsPerInstance: peakRps },
    basis: `pic observé (${Math.round(peakMb)} Mo à ${round1(peakRps)} req/s par instance), extrapolé proportionnellement au-delà : estimation prudente`,
  };
}

export interface SerialFractionCalibration {
  value: number;
  basis: string;
}

/**
 * Fraction série déduite de deux tests dont la limite a été atteinte, avec des nombres d'instances différents.
 * Gain mesuré S = R2/R1 pour k = n2/n1 : S = k / (1 + sf·(k − 1)), d'où sf = (k/S − 1) / (k − 1).
 */
export function calibrateSerialFraction(
  runs: Array<{ instances: number; capacity: CapacityEvidence }>,
): SerialFractionCalibration | null {
  const bracketed = runs
    .filter((r) => r.capacity.kind === "bracketed" && r.capacity.sustainedRps !== null)
    .sort((a, b) => a.instances - b.instances);
  if (bracketed.length < 2) return null;

  const small = bracketed[0];
  const large = bracketed[bracketed.length - 1];
  if (large.instances === small.instances) return null;

  const k = large.instances / small.instances;
  const gain = (large.capacity.sustainedRps as number) / (small.capacity.sustainedRps as number);
  const raw = (k / gain - 1) / (k - 1);
  const value = Math.min(1, Math.max(0, raw));

  return {
    value,
    basis: `${small.instances} → ${large.instances} instances : ${small.capacity.sustainedRps} → ${large.capacity.sustainedRps} req/s (gain ×${round1(gain * 100) / 100} au lieu de ×${round1(k * 100) / 100})`,
  };
}