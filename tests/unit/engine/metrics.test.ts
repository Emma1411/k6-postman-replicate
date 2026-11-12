import { describe, it, expect } from "vitest";
import { MetricsRecorder } from "@/server/engine/metrics/recorder";
import { MetricsAggregator } from "@/server/engine/metrics/aggregator";
import type { WindowDelta } from "@/server/engine/metrics/types";

function delta(build: (r: MetricsRecorder) => void): WindowDelta {
  const recorder = new MetricsRecorder();
  build(recorder);
  return recorder.flush();
}

const req = (durationMs: number, status = 200) => ({
  durationMs,
  failed: status >= 400,
  status,
  bytesSent: 100,
  bytesReceived: 1000,
});

describe("MetricsRecorder", () => {
  it("accumule puis repart de zéro après flush", () => {
    const r = new MetricsRecorder();
    r.setVus(5);
    r.recordRequest({ durationMs: 100, failed: false, status: 200, bytesSent: 10, bytesReceived: 100 });
    r.recordRequest({ durationMs: null, failed: true, status: null, bytesSent: 10, bytesReceived: 0 });
    r.recordChecks(2, 1);
    r.recordIteration(250);

    const d = r.flush();
    expect(d.requests).toBe(2);
    expect(d.failed).toBe(1);
    expect(d.status).toEqual({ "200": 1, error: 1 });
    expect(d.duration.count).toBe(1); // pas de durée sans réponse
    expect(d.iterationDuration.count).toBe(1);
    expect(d.checksPassed).toBe(2);
    expect(d.checksFailed).toBe(1);
    expect(d.dataSent).toBe(20);
    expect(d.dataReceived).toBe(100);
    expect(d.vus).toBe(5);

    const empty = r.flush();
    expect(empty.requests).toBe(0);
    expect(empty.status).toEqual({});
    expect(empty.duration.count).toBe(0);
    expect(empty.vus).toBe(5); // la jauge de VUs persiste
  });
});

describe("MetricsAggregator", () => {
  function twoWindows() {
    const agg = new MetricsAggregator();

    agg.addDelta(
      1,
      delta((r) => {
        r.setVus(5);
        r.recordRequest(req(100));
        r.recordRequest(req(200));
        r.recordRequest(req(300, 500));
        r.recordChecks(2, 1);
        r.recordIteration(600);
      }),
    );
    agg.addDelta(
      2,
      delta((r) => {
        r.setVus(3);
        r.recordRequest(req(400));
        r.recordChecks(1, 0);
      }),
    );
    const first = agg.closeWindow(1);

    agg.addDelta(
      1,
      delta((r) => {
        r.setVus(5);
        r.recordRequest(req(50));
        r.recordRequest(req(60));
      }),
    );
    agg.addDelta(2, delta((r) => r.setVus(3)));
    const second = agg.closeWindow(2);

    return { agg, first, second };
  }

  it("calcule la fenêtre courante en fusionnant les workers", () => {
    const { first, second } = twoWindows();

    expect(first.t).toBe(1);
    expect(first.vus).toBe(8);
    expect(first.requests).toBe(4);
    expect(first.rps).toBe(4);
    expect(first.failed).toBe(1);
    expect(first.errorRate).toBe(0.25);
    expect(first.iterations).toBe(1);
    expect(first.checksPassed).toBe(3);
    expect(first.checksFailed).toBe(1);
    expect(first.dataSent).toBe(400);
    expect(first.dataReceived).toBe(4000);
    expect(first.duration?.count).toBe(4);
    expect(first.duration?.avg).toBe(250);
    expect(first.duration?.min).toBe(100);
    expect(first.duration?.max).toBe(400);
    expect(first.duration?.p95).toBe(400);
    expect(first.duration?.med).toBeCloseTo(200, 0);

    // la deuxième fenêtre repart de zéro
    expect(second.requests).toBe(2);
    expect(second.duration?.count).toBe(2);
    expect(second.errorRate).toBe(0);
  });

  it("renvoie des valeurs vides pour une fenêtre sans activité", () => {
    const agg = new MetricsAggregator();
    const point = agg.closeWindow(1);
    expect(point.requests).toBe(0);
    expect(point.duration).toBeNull();
    expect(point.errorRate).toBeNull();
  });

  it("calcule le résumé cumulé", () => {
    const { agg } = twoWindows();
    const s = agg.snapshot();

    expect(s.elapsedSeconds).toBe(2);
    expect(s.http_reqs).toEqual({ count: 6, rate: 3 });
    expect(s.http_req_failed).toEqual({ rate: 0.1667, fails: 1, total: 6 });
    expect(s.checks).toEqual({ rate: 0.75, passes: 3, fails: 1 });
    expect(s.iterations.count).toBe(1);
    expect(s.data_sent).toEqual({ count: 600, rate: 300 });
    expect(s.statusDistribution).toEqual({ "200": 5, "500": 1 });
    expect(s.vus).toEqual({ value: 8, min: 8, max: 8 });
    expect(s.http_req_duration?.count).toBe(6);
    expect(s.iteration_duration?.count).toBe(1);
  });

  it("lit les valeurs pour les thresholds", () => {
    const { agg } = twoWindows();
    // durées cumulées : 50, 60, 100, 200, 300, 400 ms
    expect(agg.getValue("http_req_duration", { type: "avg" })).toBe(185);
    expect(agg.getValue("http_req_duration", { type: "min" })).toBe(50);
    expect(agg.getValue("http_req_duration", { type: "max" })).toBe(400);
    expect(agg.getValue("http_req_duration", { type: "count" })).toBe(6);
    expect(agg.getValue("http_req_duration", { type: "p", percentile: 95 })).toBe(400);
    expect(agg.getValue("http_req_duration", { type: "med" })).toBeCloseTo(100, 0);

    expect(agg.getValue("http_req_failed", { type: "rate" })).toBeCloseTo(1 / 6, 10);
    expect(agg.getValue("checks", { type: "rate" })).toBe(0.75);
    expect(agg.getValue("http_reqs", { type: "count" })).toBe(6);
    expect(agg.getValue("http_reqs", { type: "rate" })).toBe(3);
    expect(agg.getValue("vus", { type: "value" })).toBe(8);
    expect(agg.getValue("vus", { type: "min" })).toBe(8);
    expect(agg.getValue("vus", { type: "max" })).toBe(8);
  });

  it("renvoie null sans donnée ou pour une agrégation non applicable", () => {
    const empty = new MetricsAggregator();
    expect(empty.getValue("http_req_duration", { type: "avg" })).toBeNull();
    expect(empty.getValue("http_req_failed", { type: "rate" })).toBeNull();
    expect(empty.getValue("checks", { type: "rate" })).toBeNull();
    expect(empty.getValue("vus", { type: "min" })).toBeNull();

    const { agg } = twoWindows();
    expect(agg.getValue("http_req_failed", { type: "avg" })).toBeNull();
    expect(agg.getValue("vus", { type: "count" })).toBeNull();
  });

  it("borne le nombre de points conservés", () => {
    const agg = new MetricsAggregator(3);
    for (let t = 1; t <= 5; t++) agg.closeWindow(t);
    const points = agg.getPoints();
    expect(points).toHaveLength(3);
    expect(points[0].t).toBe(3);
  });
});