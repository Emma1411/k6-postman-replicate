import "server-only";
import { AppError } from "@/server/utils/errors";
import { averageSeries, buildSamples, type MetricPoints } from "@/shared/advisor/prometheus-normalize";
import { PROMETHEUS_METRIC_KEYS, type PrometheusQueryInput } from "@/shared/schemas";
import type { InfrastructureQueryResult, PrometheusMetricStatus } from "@/shared/types/infrastructure-result";
import { queryRange, type PrometheusDeps } from "./client";

/** Prometheus refuse les requêtes qui renverraient plus de 11 000 points par série. */
const MAX_POINTS = 11_000;

/**
 * Interroge Prometheus sur la période d'un test de charge et renvoie des échantillons alignés sur le test
 * (t = 0 au début du test), prêts à servir d'infraMetrics à l'Advisor.
 * Une métrique en échec ou sans donnée n'empêche pas les autres ; elle est signalée dans `metrics` et `missing`.
 */
export async function queryInfrastructure(
  input: PrometheusQueryInput,
  deps: PrometheusDeps,
): Promise<InfrastructureQueryResult> {
  const { durationSeconds, stepSeconds } = input;

  const pointsPerSeries = Math.floor(durationSeconds / stepSeconds) + 1;
  if (pointsPerSeries > MAX_POINTS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Cette requête demanderait ${pointsPerSeries} points par série (maximum ${MAX_POINTS} côté Prometheus) : augmente le pas ou réduis la durée.`,
    );
  }

  // Horodatage Prometheus correspondant au début du test, en tenant compte du décalage d'horloge.
  const start = input.startedAtMs / 1000 + input.clockOffsetSeconds;
  const end = start + durationSeconds;
  const conn = { baseUrl: input.baseUrl, auth: input.auth };

  const entries = PROMETHEUS_METRIC_KEYS.flatMap((key) => {
    const query = input.queries[key];
    return query ? [{ key, query }] : [];
  });
  const settled = await Promise.allSettled(entries.map((e) => queryRange(conn, e.query, start, end, stepSeconds, deps)));

  const metrics: PrometheusMetricStatus[] = [];
  const collected: MetricPoints[] = [];
  const warnings: string[] = [];
  const errors: unknown[] = [];

  settled.forEach((outcome, i) => {
    const { key, query } = entries[i];

    if (outcome.status === "rejected") {
      errors.push(outcome.reason);
      metrics.push({
        key,
        query,
        status: "error",
        seriesCount: 0,
        points: 0,
        message: outcome.reason instanceof AppError ? outcome.reason.message : "Erreur inattendue.",
      });
      return;
    }

    const series = outcome.value;
    const { points, dropped } = averageSeries(series);
    if (dropped > 0) warnings.push(`${key} : ${dropped} valeur(s) non numériques (NaN, Inf) ignorées.`);
    if (series.length > 1) {
      warnings.push(
        `${key} : la requête renvoie ${series.length} séries, elles sont moyennées. Agrège-la dans PromQL (avg ou sum) pour maîtriser le résultat.`,
      );
    }

    if (points.size === 0) {
      metrics.push({
        key,
        query,
        status: "no-data",
        seriesCount: series.length,
        points: 0,
        message: "Aucune donnée sur la période : vérifie le décalage d'horloge, le sélecteur et la fenêtre de rate().",
      });
      return;
    }

    metrics.push({ key, query, status: "ok", seriesCount: series.length, points: points.size, message: null });
    collected.push({ key, points });
  });

  if (collected.length === 0) {
    if (errors.length > 0) throw errors[0];
    throw new AppError(
      "UPSTREAM_ERROR",
      "Prometheus n'a renvoyé aucune donnée sur la période demandée. Vérifie le décalage d'horloge, les sélecteurs et les dates du test.",
    );
  }

  const { samples, clamped } = buildSamples(collected, start);
  if (clamped > 0) {
    warnings.push(`${clamped} valeur(s) hors bornes ramenées dans les limites (pourcentages entre 0 et 100, valeurs négatives à 0).`);
  }

  return {
    infraMetrics: { provenance: "observed", samples },
    metrics,
    missing: PROMETHEUS_METRIC_KEYS.filter((key) => !collected.some((c) => c.key === key)),
    warnings,
    range: { startedAtMs: input.startedAtMs, durationSeconds, stepSeconds, samples: samples.length },
  };
}