import "server-only";
import type { LoadMetricName } from "@/shared/schemas";
import type { MetricsSnapshot, TrendStats, WindowPoint } from "@/shared/types/load-result";
import { Histogram } from "./histogram";
import { round2, round4 } from "./round";
import type { Aggregation, MetricValueReader, WindowDelta } from "./types";

interface Counters {
  requests: number;
  failed: number;
  checksPassed: number;
  checksFailed: number;
  dropped: number;
  iterations: number;
  dataSent: number;
  dataReceived: number;
}

const zeroCounters = (): Counters => ({
  requests: 0,
  failed: 0,
  checksPassed: 0,
  dropped: 0,
  checksFailed: 0,
  iterations: 0,
  dataSent: 0,
  dataReceived: 0,
});

function addTo(target: Counters, d: WindowDelta): void {
  target.requests += d.requests;
  target.failed += d.failed;
  target.checksPassed += d.checksPassed;
  target.checksFailed += d.checksFailed;
  target.dropped += d.dropped;
  target.iterations += d.iterations;
  target.dataSent += d.dataSent;
  target.dataReceived += d.dataReceived;
}

function trendStats(h: Histogram): TrendStats | null {
  if (h.count === 0) return null;
  const ms = (us: number) => round2(us / 1000);
  return {
    count: h.count,
    avg: ms(h.sum / h.count),
    min: ms(h.min),
    max: ms(h.max),
    med: ms(h.valueAtPercentile(50)),
    p90: ms(h.valueAtPercentile(90)),
    p95: ms(h.valueAtPercentile(95)),
    p99: ms(h.valueAtPercentile(99)),
  };
}

function trendValue(h: Histogram, agg: Aggregation): number | null {
  if (h.count === 0) return null;
  switch (agg.type) {
    case "avg":
      return h.sum / h.count / 1000;
    case "min":
      return h.min / 1000;
    case "max":
      return h.max / 1000;
    case "med":
      return h.valueAtPercentile(50) / 1000;
    case "count":
      return h.count;
    case "p":
      return h.valueAtPercentile(agg.percentile) / 1000;
    default:
      return null;
  }
}

function counterValue(count: number, agg: Aggregation, elapsedSeconds: number): number | null {
  if (agg.type === "count") return count;
  if (agg.type === "rate") return elapsedSeconds > 0 ? count / elapsedSeconds : null;
  return null;
}

/**
 * Agrège les fenêtres envoyées par les workers : une fenêtre par seconde pour les graphiques,
 * et des valeurs cumulées pour les thresholds et le résumé final.
 */
export class MetricsAggregator implements MetricValueReader {
  private readonly durationAll = new Histogram();
  private readonly iterationAll = new Histogram();
  private readonly durationWindow = new Histogram();
  private readonly status = new Map<string, number>();
  private readonly vusByWorker = new Map<number, number>();
  private readonly points: WindowPoint[] = [];
  private readonly maxPoints: number;
  private totals: Counters = zeroCounters();
  private pending: Counters = zeroCounters();
  private vusNow = 0;
  private vusMin = Infinity;
  private vusMax = 0;
  private elapsedSeconds = 0;

  constructor(maxPoints = 7200) {
    this.maxPoints = maxPoints;
  }

  addDelta(workerId: number, delta: WindowDelta): void {
    addTo(this.totals, delta);
    addTo(this.pending, delta);
    for (const [code, n] of Object.entries(delta.status)) {
      this.status.set(code, (this.status.get(code) ?? 0) + n);
    }
    this.durationAll.mergeSnapshot(delta.duration);
    this.durationWindow.mergeSnapshot(delta.duration);
    this.iterationAll.mergeSnapshot(delta.iterationDuration);
    this.vusByWorker.set(workerId, delta.vus);
  }

  /** Clôt la fenêtre courante. `windowSeconds` sert au calcul du débit (1 s sauf dernière fenêtre partielle). */
  closeWindow(elapsedSeconds: number, windowSeconds = 1): WindowPoint {
    this.elapsedSeconds = elapsedSeconds;

    let vus = 0;
    for (const v of this.vusByWorker.values()) vus += v;
    this.vusNow = vus;
    if (vus < this.vusMin) this.vusMin = vus;
    if (vus > this.vusMax) this.vusMax = vus;

    const p = this.pending;
    const point: WindowPoint = {
      t: round2(elapsedSeconds),
      vus,
      requests: p.requests,
      rps: windowSeconds > 0 ? round2(p.requests / windowSeconds) : 0,
      failed: p.failed,
      errorRate: p.requests > 0 ? round4(p.failed / p.requests) : null,
      duration: trendStats(this.durationWindow),
      iterations: p.iterations,
      dropped: p.dropped,
      checksPassed: p.checksPassed,
      checksFailed: p.checksFailed,
      dataSent: p.dataSent,
      dataReceived: p.dataReceived,
    };

    this.points.push(point);
    if (this.points.length > this.maxPoints) this.points.shift();
    this.pending = zeroCounters();
    this.durationWindow.reset();
    return point;
  }

  getPoints(): readonly WindowPoint[] {
    return this.points;
  }

  snapshot(): MetricsSnapshot {
    const t = this.totals;
    const elapsed = this.elapsedSeconds;
    const perSecond = (n: number) => (elapsed > 0 ? round2(n / elapsed) : 0);
    const checks = t.checksPassed + t.checksFailed;

    return {
      elapsedSeconds: round2(elapsed),
      vus: { value: this.vusNow, min: this.vusMin === Infinity ? 0 : this.vusMin, max: this.vusMax },
      http_reqs: { count: t.requests, rate: perSecond(t.requests) },
      http_req_failed: {
        rate: t.requests > 0 ? round4(t.failed / t.requests) : null,
        fails: t.failed,
        total: t.requests,
      },
      http_req_duration: trendStats(this.durationAll),
      iterations: { count: t.iterations, rate: perSecond(t.iterations) },
      dropped_iterations: { count: t.dropped, rate: perSecond(t.dropped) },
      iteration_duration: trendStats(this.iterationAll),
      checks: {
        rate: checks > 0 ? round4(t.checksPassed / checks) : null,
        passes: t.checksPassed,
        fails: t.checksFailed,
      },
      data_sent: { count: t.dataSent, rate: perSecond(t.dataSent) },
      data_received: { count: t.dataReceived, rate: perSecond(t.dataReceived) },
      statusDistribution: Object.fromEntries(this.status),
    };
  }

  getValue(metric: LoadMetricName, agg: Aggregation): number | null {
    const t = this.totals;
    switch (metric) {
      case "http_req_duration":
        return trendValue(this.durationAll, agg);
      case "iteration_duration":
        return trendValue(this.iterationAll, agg);
      case "http_req_failed":
        return agg.type === "rate" && t.requests > 0 ? t.failed / t.requests : null;
      case "checks": {
        const total = t.checksPassed + t.checksFailed;
        return agg.type === "rate" && total > 0 ? t.checksPassed / total : null;
      }
      case "http_reqs":
        return counterValue(t.requests, agg, this.elapsedSeconds);
      case "iterations":
        return counterValue(t.iterations, agg, this.elapsedSeconds);
      case "data_sent":
        return counterValue(t.dataSent, agg, this.elapsedSeconds);
      case "data_received":
        return counterValue(t.dataReceived, agg, this.elapsedSeconds);
      case "dropped_iterations":
        return counterValue(t.dropped, agg, this.elapsedSeconds);
      case "vus":
        if (agg.type === "value") return this.vusNow;
        if (agg.type === "min") return this.vusMin === Infinity ? null : this.vusMin;
        if (agg.type === "max") return this.vusMax;
        return null;
    }
  }
}