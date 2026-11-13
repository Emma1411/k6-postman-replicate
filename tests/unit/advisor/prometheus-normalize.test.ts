import { describe, it, expect } from "vitest";
import { averageSeries, buildSamples } from "@/shared/advisor/prometheus-normalize";

describe("averageSeries", () => {
  it("renvoie une série telle quelle", () => {
    const { points, dropped } = averageSeries([{ values: [[100, "1"], [105, "2"]] }]);
    expect([...points]).toEqual([[100_000, 1], [105_000, 2]]);
    expect(dropped).toBe(0);
  });

  it("moyenne plusieurs séries à chaque horodatage", () => {
    const { points } = averageSeries([
      { values: [[100, "10"], [105, "20"]] },
      { values: [[100, "30"], [105, "40"]] },
    ]);
    expect(points.get(100_000)).toBe(20);
    expect(points.get(105_000)).toBe(30);
  });

  it("ignore NaN et Inf et les compte", () => {
    const { points, dropped } = averageSeries([{ values: [[100, "NaN"], [105, "+Inf"], [110, "-Inf"], [115, "5"]] }]);
    expect([...points]).toEqual([[115_000, 5]]);
    expect(dropped).toBe(3);
  });

  it("aligne les horodatages à la milliseconde", () => {
    const { points } = averageSeries([{ values: [[100.0004, "1"]] }, { values: [[100, "3"]] }]);
    expect(points.size).toBe(1);
    expect(points.get(100_000)).toBe(2);
  });
});

describe("buildSamples", () => {
  const cpu = new Map([[1_000_000, 10], [1_005_000, 20], [1_010_000, 30]]);
  const memory = new Map([[1_005_000, 55], [1_010_000, 60]]);

  it("fusionne les métriques par instant, avec t mesuré depuis l'origine", () => {
    const { samples, clamped } = buildSamples(
      [{ key: "cpuPercent", points: cpu }, { key: "memoryPercent", points: memory }],
      1000,
    );
    expect(clamped).toBe(0);
    expect(samples).toEqual([
      { t: 0, cpuPercent: 10 },
      { t: 5, cpuPercent: 20, memoryPercent: 55 },
      { t: 10, cpuPercent: 30, memoryPercent: 60 },
    ]);
  });

  it("ramène les valeurs hors bornes dans les limites et les compte", () => {
    const { samples, clamped } = buildSamples(
      [
        { key: "cpuPercent", points: new Map([[1_000_000, 130]]) },
        { key: "memoryAvailableMb", points: new Map([[1_000_000, -4]]) },
        { key: "dbConnectionsUsed", points: new Map([[1_000_000, 12]]) },
      ],
      1000,
    );
    expect(clamped).toBe(2);
    expect(samples[0]).toEqual({ t: 0, cpuPercent: 100, memoryAvailableMb: 0, dbConnectionsUsed: 12 });
  });

  it("écarte les points antérieurs au début du test et recale les écarts minimes", () => {
    const { samples } = buildSamples(
      [{ key: "cpuPercent", points: new Map([[990_000, 5], [999_800, 6], [1_005_000, 7]]) }],
      1000,
    );
    expect(samples.map((s) => s.t)).toEqual([0, 5]);
    expect(samples[0].cpuPercent).toBe(6);
  });

  it("renvoie les échantillons triés", () => {
    const { samples } = buildSamples([{ key: "cpuPercent", points: new Map([[1_010_000, 3], [1_000_000, 1], [1_005_000, 2]]) }], 1000);
    expect(samples.map((s) => s.t)).toEqual([0, 5, 10]);
  });
});