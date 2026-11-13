import { describe, it, expect } from "vitest";
import { alignSeries, baselineP95, longestRun, medianStep, rolling } from "@/shared/advisor/series";
import { mean, median, pearson, percentile, slope } from "@/shared/advisor/stats";
import { resolveTargetRps, requiredRps } from "@/shared/advisor/objectives";
import { ObjectivesSchema } from "@/shared/schemas";
import { makeRun } from "../../helpers/advisor-fixtures";

describe("stats", () => {
  it("calcule moyenne, médiane et percentiles", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 25)).toBe(20);
    expect(percentile([10, 20], 50)).toBe(15);
    expect(percentile([], 50)).toBeNull();
  });

  it("calcule la corrélation et la pente", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(slope([0, 1, 2, 3], [1, 3, 5, 7])).toBeCloseTo(2, 10);
    expect(slope([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("séries", () => {
  const run = makeRun({
    seconds: 60,
    rps: (t) => 100 + t,
    p95: () => 50,
    cpu: (t) => t,
    sampleEvery: 15,
  });

  it("associe chaque point à l'échantillon d'infrastructure le plus proche", () => {
    const aligned = alignSeries(run.points, run.infraMetrics?.samples ?? [], 15);
    expect(aligned).toHaveLength(60);
    expect(aligned[0].cpu).toBe(15); // t = 1 → échantillon le plus proche : t = 15
    expect(aligned[29].cpu).toBe(30); // t = 30 → échantillon t = 30
    expect(aligned[50].cpu).toBe(45); // t = 51 → plus proche de 45 (écart 6) que de 60 (écart 9)
  });

  it("laisse vides les valeurs trop éloignées d'un échantillon", () => {
    const aligned = alignSeries(run.points, run.infraMetrics?.samples ?? [], 3);
    expect(aligned[0].cpu).toBeNull(); // écart de 14 s
    expect(aligned[14].cpu).toBe(15);
  });

  it("lisse sur 5 points", () => {
    const r = rolling(run.points);
    expect(r).toHaveLength(56);
    expect(r[0].t).toBe(5);
    expect(r[0].rps).toBe(103); // moyenne de 101..105
    expect(r[0].p95).toBe(50);
  });

  it("repère la plus longue séquence continue", () => {
    const aligned = alignSeries(run.points, run.infraMetrics?.samples ?? [], 15);
    const found = longestRun(aligned, (p) => p.t >= 10 && p.t <= 19 || p.t >= 30 && p.t <= 49, 1);
    expect(found).toEqual({ start: 29, end: 48, seconds: 20 });
    expect(longestRun(aligned, () => false, 1)).toBeNull();
  });

  it("calcule le pas médian", () => {
    expect(medianStep([{ t: 1 }, { t: 2 }, { t: 3 }, { t: 10 }])).toBe(1);
    expect(medianStep([{ t: 5 }])).toBe(1);
  });

  it("établit le p95 de référence selon la forme de la charge", () => {
    const flat = makeRun({ seconds: 60, rps: () => 100, p95: (t) => (t <= 20 ? 30 : 300) });
    const aligned = alignSeries(flat.points, [], 15);
    expect(baselineP95(aligned, "constant")).toBe(30); // premier tiers

    const variable = makeRun({ seconds: 100, rps: (t) => 10 + 4 * t, p95: (t) => (t < 30 ? 40 : 400) });
    expect(baselineP95(alignSeries(variable.points, [], 15), "variable")).toBe(40); // quartile le plus bas du débit
  });
});

describe("objectifs", () => {
  it("convertit des utilisateurs simultanés en débit", () => {
    const o = ObjectivesSchema.parse({ targetVus: 5000, iterationSeconds: 10, requestsPerIteration: 4, headroomPercent: 25 });
    expect(resolveTargetRps(o)).toBe(2000);
    expect(requiredRps(o)).toBe(2500);
  });

  it("préfère le débit explicite et renvoie null s'il manque des informations", () => {
    expect(resolveTargetRps(ObjectivesSchema.parse({ targetRps: 300, targetVus: 10 }))).toBe(300);
    expect(resolveTargetRps(ObjectivesSchema.parse({ targetVus: 10 }))).toBeNull();
    expect(requiredRps(ObjectivesSchema.parse({}))).toBeNull();
  });
});