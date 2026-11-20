import type { InfraSample } from "@/shared/schemas";

export type MetricKey = "cpuPercent" | "memoryPercent" | "memoryAvailableMb" | "dbConnectionsUsed" | "networkRttMs";

export const METRIC_META: Record<MetricKey, { label: string; unit: string; max?: number }> = {
  cpuPercent: { label: "Processeur", unit: "%", max: 100 },
  memoryPercent: { label: "Mémoire utilisée", unit: "%", max: 100 },
  memoryAvailableMb: { label: "Mémoire disponible", unit: "Mo" },
  dbConnectionsUsed: { label: "Connexions à la base", unit: "" },
  networkRttMs: { label: "Latence réseau", unit: "ms" },
};

export const METRIC_ORDER: MetricKey[] = ["cpuPercent", "memoryPercent", "memoryAvailableMb", "dbConnectionsUsed", "networkRttMs"];
/** Axe Y toujours ancré à 0 : 0 à `max` pour les pourcentages, sinon 0 à la valeur maximale plus 15 % de marge. */
export function yDomain(key: MetricKey): [number, number | ((dataMax: number) => number)] {
  const max = METRIC_META[key].max;
  if (max !== undefined) return [0, max];
  return [0, (dataMax: number) => Math.max(1, Math.ceil(dataMax * 1.15))];
}

export interface SeriesPoint {
  t: number;
  value: number;
}

/** La série d'une mesure, réduite à `maxPoints` points au plus (en gardant la valeur la plus haute de chaque paquet). */
export function metricSeries(samples: InfraSample[], key: MetricKey, maxPoints = 400): SeriesPoint[] {
  const all = samples.flatMap((s) => (typeof s[key] === "number" ? [{ t: s.t, value: s[key] as number }] : []));
  if (all.length <= maxPoints) return all;
  const size = Math.ceil(all.length / maxPoints);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < all.length; i += size) {
    const bucket = all.slice(i, i + size);
    out.push({ t: bucket[bucket.length - 1].t, value: Math.max(...bucket.map((p) => p.value)) });
  }
  return out;
}

/** Les mesures qui ont au moins un point. */
export const availableMetrics = (samples: InfraSample[]): MetricKey[] =>
  METRIC_ORDER.filter((key) => samples.some((s) => typeof s[key] === "number"));