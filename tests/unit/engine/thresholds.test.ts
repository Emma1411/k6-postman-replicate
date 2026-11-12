import { describe, it, expect } from "vitest";
import { MetricsAggregator } from "@/server/engine/metrics/aggregator";
import { MetricsRecorder } from "@/server/engine/metrics/recorder";
import type { MetricValueReader } from "@/server/engine/metrics/types";
import { evaluateThresholds, parseThresholds, shouldAbort } from "@/server/engine/thresholds/thresholds";
import { AppError } from "@/server/utils/errors";
import { ThresholdSchema } from "@/shared/schemas";

const t = (metric: string, expression: string, extra: Record<string, unknown> = {}) =>
  ThresholdSchema.parse({ metric, expression, ...extra });

const reader = (values: Record<string, number>): MetricValueReader => ({
  getValue: (metric, agg) => values[`${metric}:${agg.type === "p" ? `p(${agg.percentile})` : agg.type}`] ?? null,
});

describe("parseThresholds", () => {
  it("analyse les expressions courantes", () => {
    const [a, b, c, d, e] = parseThresholds([
      t("http_req_duration", "p(95)<500"),
      t("http_req_duration", "avg<=200"),
      t("http_req_failed", "rate<0.01"),
      t("http_reqs", "count>1000"),
      t("http_req_duration", "p(99.9)<1000"),
    ]);
    expect(a).toMatchObject({ aggregation: { type: "p", percentile: 95 }, operator: "<", target: 500 });
    expect(b).toMatchObject({ aggregation: { type: "avg" }, operator: "<=", target: 200 });
    expect(c).toMatchObject({ aggregation: { type: "rate" }, operator: "<", target: 0.01 });
    expect(d).toMatchObject({ aggregation: { type: "count" }, operator: ">", target: 1000 });
    expect(e.aggregation).toEqual({ type: "p", percentile: 99.9 });
  });

  it("accepte les agrégations propres à chaque type de métrique", () => {
    expect(() =>
      parseThresholds([
        t("vus", "value<=50"),
        t("vus", "max<=50"),
        t("http_reqs", "rate>5"),
        t("checks", "rate>0.99"),
        t("iteration_duration", "med<2000"),
        t("data_received", "count>0"),
      ]),
    ).not.toThrow();
  });

  it.each([
    ["http_req_failed", "p(95)<1"],
    ["http_req_duration", "rate<0.5"],
    ["http_reqs", "value<5"],
    ["vus", "avg<5"],
    ["checks", "count>1"],
  ])("refuse %s avec %s", (metric, expression) => {
    expect(() => parseThresholds([t(metric, expression)])).toThrow(AppError);
  });

  it("signale toutes les erreurs en une fois avec leur position", () => {
    try {
      parseThresholds([t("http_req_failed", "p(95)<1"), t("http_req_duration", "p(95)<500"), t("vus", "avg<5")]);
      expect.unreachable();
    } catch (e) {
      const err = e as AppError;
      expect(err.code).toBe("VALIDATION_ERROR");
      const issues = (err.details as { issues: { index: number }[] }).issues;
      expect(issues.map((i) => i.index)).toEqual([0, 2]);
    }
  });
});

describe("evaluateThresholds", () => {
  it.each([
    ["p(95)<500", true],
    ["p(95)<=480", true],
    ["p(95)>480", false],
    ["p(95)>=480", true],
    ["p(95)==480", true],
    ["p(95)!=480", false],
    ["p(95)<480", false],
  ])("évalue %s", (expression, expected) => {
    const parsed = parseThresholds([t("http_req_duration", expression)]);
    const [result] = evaluateThresholds(parsed, reader({ "http_req_duration:p(95)": 480 }), true);
    expect(result.passed).toBe(expected);
    expect(result.noData).toBe(false);
  });

  it("arrondit la valeur affichée sans fausser la comparaison", () => {
    const parsed = parseThresholds([t("http_req_failed", "rate<0.123456")]);
    const [result] = evaluateThresholds(parsed, reader({ "http_req_failed:rate": 0.1234561 }), true);
    expect(result.value).toBe(0.1235);
    expect(result.passed).toBe(false); // 0.1234561 >= 0.123456
  });

  it("traite l'absence de donnée selon le moment", () => {
    const parsed = parseThresholds([t("http_req_duration", "p(95)<500")]);

    const [during] = evaluateThresholds(parsed, reader({}), false);
    expect(during).toMatchObject({ noData: true, passed: true, value: null });

    const [atEnd] = evaluateThresholds(parsed, reader({}), true);
    expect(atEnd).toMatchObject({ noData: true, passed: false, value: null });
  });
});

describe("shouldAbort", () => {
  const parsed = parseThresholds([
    t("http_req_failed", "rate<0.01", { abortOnFail: true, delayAbortEvalSeconds: 10 }),
    t("http_req_duration", "p(95)<100"),
  ]);
  const failing = evaluateThresholds(
    parsed,
    reader({ "http_req_failed:rate": 0.5, "http_req_duration:p(95)": 900 }),
    false,
  );

  it("attend la fin du délai d'évaluation", () => {
    expect(shouldAbort(failing, parsed, 5)).toBeNull();
    expect(shouldAbort(failing, parsed, 10)?.metric).toBe("http_req_failed");
  });

  it("ignore les thresholds sans abortOnFail et ceux sans donnée", () => {
    const onlyPlain = parseThresholds([t("http_req_duration", "p(95)<100")]);
    const results = evaluateThresholds(onlyPlain, reader({ "http_req_duration:p(95)": 900 }), false);
    expect(shouldAbort(results, onlyPlain, 100)).toBeNull();

    const abortable = parseThresholds([t("http_req_failed", "rate<0.01", { abortOnFail: true })]);
    const noData = evaluateThresholds(abortable, reader({}), false);
    expect(shouldAbort(noData, abortable, 100)).toBeNull();
  });
});

describe("thresholds sur un agrégateur réel", () => {
  it("évalue un jeu de thresholds sur 100 requêtes", () => {
    const recorder = new MetricsRecorder();
    recorder.setVus(10);
    for (let i = 1; i <= 100; i++) {
      const status = i <= 2 ? 500 : 200; // 2 % d'erreurs
      recorder.recordRequest({
        durationMs: i * 10,
        failed: status >= 400,
        status,
        bytesSent: 1,
        bytesReceived: 1,
      });
    }
    recorder.recordChecks(95, 5);

    const agg = new MetricsAggregator();
    agg.addDelta(1, recorder.flush());
    agg.closeWindow(10, 10);

    const parsed = parseThresholds([
      t("http_req_duration", "p(95)<1000"),
      t("http_req_failed", "rate<0.01"),
      t("http_req_duration", "avg<600"),
      t("checks", "rate>0.9"),
      t("http_reqs", "count>=100"),
      t("http_reqs", "rate>=10"),
    ]);
    const results = evaluateThresholds(parsed, agg, true);
    expect(results.map((r) => r.passed)).toEqual([true, false, true, true, true, true]);
    expect(results[1].value).toBe(0.02);
  });
});