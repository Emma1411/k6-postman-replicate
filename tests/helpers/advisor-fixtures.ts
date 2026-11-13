import { MeasuredRunSchema, type MeasuredRun } from "@/shared/schemas";

interface Spec {
  seconds: number;
  rps: (t: number) => number;
  p95: (t: number) => number;
  errorRate?: (t: number) => number;
  dropped?: (t: number) => number;
  cpu?: (t: number) => number;
  mem?: (t: number) => number;
  memAvailMb?: (t: number) => number;
  db?: (t: number) => number;
  rtt?: (t: number) => number;
  instances?: number;
  vcpu?: number;
  ramGb?: number;
  pool?: number;
  generatorSaturated?: boolean;
  /** Pas des échantillons d'infrastructure, en secondes. */
  sampleEvery?: number;
}

export function makeRun(spec: Spec): MeasuredRun {
  const points = [];
  const samples = [];
  const hasInfra = spec.cpu || spec.mem || spec.memAvailMb || spec.db || spec.rtt;

  for (let t = 1; t <= spec.seconds; t++) {
    const requests = Math.round(spec.rps(t));
    const p95 = spec.p95(t);
    points.push({
      t,
      vus: Math.round(requests / 10),
      requests,
      rps: requests,
      failed: Math.round(requests * (spec.errorRate?.(t) ?? 0)),
      duration: { avg: p95 / 2, med: p95 / 2, p95, p99: p95 * 1.2 },
      dropped: spec.dropped?.(t) ?? 0,
    });

    if (hasInfra && t % (spec.sampleEvery ?? 1) === 0) {
      samples.push({
        t,
        cpuPercent: spec.cpu?.(t),
        memoryPercent: spec.mem?.(t),
        memoryAvailableMb: spec.memAvailMb?.(t),
        dbConnectionsUsed: spec.db?.(t),
        networkRttMs: spec.rtt?.(t),
      });
    }
  }

  return MeasuredRunSchema.parse({
    infra: {
      instances: spec.instances ?? 1,
      vcpuPerInstance: spec.vcpu ?? 2,
      ramGbPerInstance: spec.ramGb ?? 2,
      poolSizePerInstance: spec.pool,
    },
    points,
    infraMetrics: samples.length > 0 ? { provenance: "observed", samples } : undefined,
    generatorSaturated: spec.generatorSaturated ?? false,
  });
}

/** Rampe de 14 à 490 req/s sur 120 s. */
export const ramp = (t: number) => 10 + 4 * t;

/** Latence stable à 40 ms puis qui s'envole à partir de `kneeAt` secondes (+20 ms par seconde). */
export const latencyKnee = (kneeAt: number) => (t: number) => (t < kneeAt ? 40 : 40 + (t - kneeAt) * 20);