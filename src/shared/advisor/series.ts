import type { InfraSample, LoadPoint } from "@/shared/schemas";
import { mean, median, percentile, sum } from "./stats";

export interface AlignedPoint {
  t: number;
  rps: number;
  vus: number;
  requests: number;
  failed: number;
  dropped: number;
  p95: number | null;
  errorRate: number | null;
  cpu: number | null;
  mem: number | null;
  memAvailMb: number | null;
  dbUsed: number | null;
  rtt: number | null;
}

/** Associe à chaque point de charge l'échantillon d'infrastructure le plus proche dans le temps. */
export function alignSeries(points: LoadPoint[], samples: InfraSample[], maxGapSeconds: number): AlignedPoint[] {
  const sortedPoints = [...points].sort((a, b) => a.t - b.t);
  const sortedSamples = [...samples].sort((a, b) => a.t - b.t);
  const out: AlignedPoint[] = [];
  let j = 0;

  for (const p of sortedPoints) {
    while (j + 1 < sortedSamples.length && Math.abs(sortedSamples[j + 1].t - p.t) <= Math.abs(sortedSamples[j].t - p.t)) j++;
    const sample = sortedSamples[j];
    const near = sample !== undefined && Math.abs(sample.t - p.t) <= maxGapSeconds ? sample : undefined;

    out.push({
      t: p.t,
      rps: p.rps,
      vus: p.vus,
      requests: p.requests,
      failed: p.failed,
      dropped: p.dropped,
      p95: p.duration?.p95 ?? null,
      errorRate: p.requests > 0 ? p.failed / p.requests : null,
      cpu: near?.cpuPercent ?? null,
      mem: near?.memoryPercent ?? null,
      memAvailMb: near?.memoryAvailableMb ?? null,
      dbUsed: near?.dbConnectionsUsed ?? null,
      rtt: near?.networkRttMs ?? null,
    });
  }
  return out;
}

export interface RollingPoint {
  t: number;
  rps: number;
  p95: number | null;
  errorRate: number | null;
}

/** Lissage sur 5 points : médiane du p95, débit moyen, taux d'erreur pondéré par les requêtes. */
export function rolling(points: LoadPoint[], size = 5): RollingPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const n = Math.min(size, sorted.length);
  const out: RollingPoint[] = [];

  for (let i = n - 1; i < sorted.length; i++) {
    const window = sorted.slice(i - n + 1, i + 1);
    const requests = sum(window.map((p) => p.requests));
    const failed = sum(window.map((p) => p.failed));
    const p95s = window.flatMap((p) => (p.duration ? [p.duration.p95] : []));
    out.push({
      t: sorted[i].t,
      rps: mean(window.map((p) => p.rps)) ?? 0,
      p95: median(p95s),
      errorRate: requests > 0 ? failed / requests : null,
    });
  }
  return out;
}

/** Pas médian entre deux points (secondes), 1 par défaut. */
export function medianStep(points: Array<{ t: number }>): number {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const steps: number[] = [];
  for (let i = 1; i < sorted.length; i++) steps.push(sorted[i].t - sorted[i - 1].t);
  const m = median(steps);
  return m !== null && m > 0 ? m : 1;
}

export interface Run {
  /** Indices (inclus) dans la série. */
  start: number;
  end: number;
  seconds: number;
}

/** Plus longue séquence continue de points vérifiant le prédicat. */
export function longestRun(aligned: AlignedPoint[], predicate: (p: AlignedPoint) => boolean, step: number): Run | null {
  let best: Run | null = null;
  let start = -1;

  for (let i = 0; i <= aligned.length; i++) {
    const ok = i < aligned.length && predicate(aligned[i]);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const end = i - 1;
      const seconds = aligned[end].t - aligned[start].t + step;
      if (best === null || seconds > best.seconds) best = { start, end, seconds };
      start = -1;
    }
  }
  return best;
}

/** p95 de référence à faible charge : quartile le plus bas du débit (charge variable) ou premier tiers (charge constante). */
export function baselineP95(aligned: AlignedPoint[], shape: "variable" | "constant"): number | null {
  const usable = aligned.slice(Math.min(3, aligned.length >> 2)).filter((p) => p.p95 !== null);
  if (usable.length === 0) return null;

  if (shape === "variable") {
    const q25 = percentile(usable.map((p) => p.rps), 25) as number;
    return median(usable.filter((p) => p.rps <= q25).map((p) => p.p95 as number));
  }
  const third = Math.max(1, Math.floor(usable.length / 3));
  return median(usable.slice(0, third).map((p) => p.p95 as number));
}