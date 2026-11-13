import type { InfraSample, PrometheusMetricKey } from "@/shared/schemas";

export interface MatrixSeries {
  metric?: Record<string, string>;
  /** Paires [horodatage en secondes, valeur sous forme de texte]. */
  values: Array<[number, string]>;
}

/** Moyenne des séries à chaque horodatage (clé : millisecondes). Les valeurs non numériques (NaN, Inf) sont ignorées. */
export function averageSeries(series: MatrixSeries[]): { points: Map<number, number>; dropped: number } {
  const sums = new Map<number, { sum: number; count: number }>();
  let dropped = 0;

  for (const s of series) {
    for (const [timestamp, raw] of s.values) {
      const value = Number(raw);
      if (!Number.isFinite(value) || !Number.isFinite(timestamp)) {
        dropped++;
        continue;
      }
      const key = Math.round(timestamp * 1000);
      const acc = sums.get(key);
      if (acc) {
        acc.sum += value;
        acc.count++;
      } else {
        sums.set(key, { sum: value, count: 1 });
      }
    }
  }

  const points = new Map<number, number>();
  for (const [key, { sum, count }] of sums) points.set(key, sum / count);
  return { points, dropped };
}

export interface MetricPoints {
  key: PrometheusMetricKey;
  points: Map<number, number>;
}

const BOUNDS: Record<PrometheusMetricKey, { min: number; max: number }> = {
  cpuPercent: { min: 0, max: 100 },
  memoryPercent: { min: 0, max: 100 },
  memoryAvailableMb: { min: 0, max: Infinity },
  dbConnectionsUsed: { min: 0, max: Infinity },
  networkRttMs: { min: 0, max: Infinity },
};

/**
 * Fusionne les métriques en échantillons d'infrastructure. `originSeconds` est l'horodatage Prometheus
 * qui correspond au début du test : t = horodatage - origine.
 * Les valeurs hors bornes (un CPU à 101 %, une mémoire négative) sont ramenées dans les bornes et comptées.
 */
export function buildSamples(
  metrics: MetricPoints[],
  originSeconds: number,
): { samples: InfraSample[]; clamped: number } {
  const byTime = new Map<number, InfraSample>();
  let clamped = 0;

  for (const { key, points } of metrics) {
    const { min, max } = BOUNDS[key];
    for (const [ms, value] of points) {
      const t = ms / 1000 - originSeconds;
      if (t < -0.5) continue; // avant le début du test
      const bounded = Math.min(max, Math.max(min, value));
      if (bounded !== value) clamped++;

      const tKey = Math.round(Math.max(0, t) * 1000);
      const sample = byTime.get(tKey) ?? { t: tKey / 1000 };
      sample[key] = bounded;
      byTime.set(tKey, sample);
    }
  }

  return { samples: [...byTime.values()].sort((a, b) => a.t - b.t), clamped };
}