import { describe, it, expect } from "vitest";
import { calibrateCpuCost, calibrateMemory, calibrateSerialFraction } from "@/shared/advisor/capacity/calibrate";
import { linearRegression } from "@/shared/advisor/stats";
import { PolicySchema } from "@/shared/schemas";
import type { CapacityEvidence } from "@/shared/types/advisor-result";
import { makeRun } from "../../helpers/advisor-fixtures";

const policy = PolicySchema.parse({});

describe("linearRegression", () => {
  it("retrouve une droite exacte", () => {
    const reg = linearRegression([1, 2, 3, 4], [3, 5, 7, 9]);
    expect(reg?.slope).toBeCloseTo(2, 10);
    expect(reg?.intercept).toBeCloseTo(1, 10);
    expect(reg?.r).toBeCloseTo(1, 10);
    expect(reg?.slopeStdErr).toBeCloseTo(0, 10);
  });

  it("renvoie null sans variation ou avec trop peu de points", () => {
    expect(linearRegression([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(linearRegression([1, 2], [1, 2])).toBeNull();
  });

  it("estime l'incertitude de la pente avec du bruit", () => {
    const xs = Array.from({ length: 50 }, (_, i) => i);
    const ys = xs.map((x, i) => 2 * x + (i % 2 === 0 ? 3 : -3));
    const reg = linearRegression(xs, ys);
    expect(reg?.slope).toBeCloseTo(2, 1);
    expect(reg?.slopeStdErr).toBeGreaterThan(0);
  });
});

describe("calibrateCpuCost", () => {
  it("retrouve le coût CPU par requête depuis la pente CPU / débit", () => {
    // 20 ms de CPU par requête sur 2 vCPU : pente = 100·20 / (1·2·1000) = 1 point de CPU par req/s, 5 % au repos
    const run = makeRun({ seconds: 80, rps: (t) => 5 + t, p95: () => 40, cpu: (t) => 5 + (5 + t), vcpu: 2, instances: 1 });
    const cal = calibrateCpuCost(run, policy);
    expect(cal?.cpuMsPerRequest).toBeCloseTo(20, 6);
    expect(cal?.idlePercent).toBeCloseTo(5, 6);
    expect(cal?.r).toBeCloseTo(1, 6);
    expect(cal?.uncertainty).toBe(0.1); // plancher
  });

  it("tient compte du nombre d'instances et de vCPU", () => {
    // 2 instances de 4 vCPU : même pente de 0,25 point par req/s → s = 0,25 · 2 · 4 · 10 = 20 ms
    const run = makeRun({ seconds: 80, rps: (t) => 5 + 4 * t, p95: () => 40, cpu: (t) => 0.25 * (5 + 4 * t), vcpu: 4, instances: 2 });
    expect(calibrateCpuCost(run, policy)?.cpuMsPerRequest).toBeCloseTo(20, 6);
  });

  it("écarte les points saturés", () => {
    const run = makeRun({
      seconds: 100,
      rps: (t) => 5 + t,
      p95: () => 40,
      cpu: (t) => Math.min(100, 5 + (5 + t)), // plafonne à 100 % à partir de t = 90
    });
    expect(calibrateCpuCost(run, policy)?.cpuMsPerRequest).toBeCloseTo(20, 6);
  });

  it("renvoie null sans métriques, avec trop peu de points ou sans corrélation", () => {
    expect(calibrateCpuCost(makeRun({ seconds: 80, rps: (t) => 5 + t, p95: () => 40 }), policy)).toBeNull();
    expect(calibrateCpuCost(makeRun({ seconds: 6, rps: (t) => 5 + t, p95: () => 40, cpu: (t) => 10 + t }), policy)).toBeNull();
    const noisy = makeRun({ seconds: 80, rps: (t) => 5 + t, p95: () => 40, cpu: (t) => (t % 2 === 0 ? 20 : 60) });
    expect(calibrateCpuCost(noisy, policy)).toBeNull();
  });
});

describe("calibrateMemory", () => {
  it("ajuste une droite mémoire / débit par instance", () => {
    // 4 Go = 4096 Mo ; mémoire = (500 + 2 Mo par req/s) → en pourcentage de 4096
    const mem = (t: number) => ((500 + 2 * (10 + 2 * t)) / 4096) * 100;
    const run = makeRun({ seconds: 60, rps: (t) => 10 + 2 * t, p95: () => 40, mem, ramGb: 4 });
    const cal = calibrateMemory(run, policy);
    expect(cal?.model.kind).toBe("regression");
    if (cal?.model.kind === "regression") {
      expect(cal.model.baseMb).toBeCloseTo(500, 0);
      expect(cal.model.mbPerRps).toBeCloseTo(2, 2);
    }
  });

  it("se rabat sur le pic observé quand la charge est constante", () => {
    const run = makeRun({ seconds: 30, rps: () => 100, p95: () => 40, mem: () => 50, ramGb: 2 });
    const cal = calibrateMemory(run, policy);
    expect(cal?.model).toEqual({ kind: "peak", peakMb: 1024, peakRpsPerInstance: 100 });
  });

  it("renvoie null sans métriques mémoire", () => {
    expect(calibrateMemory(makeRun({ seconds: 30, rps: () => 100, p95: () => 40 }), policy)).toBeNull();
  });
});

describe("calibrateSerialFraction", () => {
  const bracketed = (rps: number): CapacityEvidence => ({
    kind: "bracketed",
    sustainedRps: rps,
    breachRps: rps + 5,
    shape: "variable",
    loadRange: { minRps: 0, maxRps: rps + 5 },
    basis: "",
  });

  it("retrouve la fraction série d'après le gain mesuré", () => {
    // gain parfait : fraction nulle ; 2 instances pour ×1,5 : sf = (2/1,5 − 1)/(2 − 1) = 1/3 ; aucun gain : 1
    expect(calibrateSerialFraction([{ instances: 1, capacity: bracketed(100) }, { instances: 2, capacity: bracketed(200) }])?.value).toBeCloseTo(0, 10);
    expect(calibrateSerialFraction([{ instances: 1, capacity: bracketed(100) }, { instances: 2, capacity: bracketed(150) }])?.value).toBeCloseTo(1 / 3, 10);
    expect(calibrateSerialFraction([{ instances: 1, capacity: bracketed(100) }, { instances: 2, capacity: bracketed(100) }])?.value).toBeCloseTo(1, 10);
  });

  it("borne le résultat entre 0 et 1", () => {
    expect(calibrateSerialFraction([{ instances: 1, capacity: bracketed(100) }, { instances: 2, capacity: bracketed(60) }])?.value).toBe(1);
    expect(calibrateSerialFraction([{ instances: 1, capacity: bracketed(100) }, { instances: 2, capacity: bracketed(260) }])?.value).toBe(0);
  });

  it("exige deux tests dont la limite est atteinte, avec des instances différentes", () => {
    const lowerBound: CapacityEvidence = { ...bracketed(100), kind: "lower-bound", breachRps: null };
    expect(calibrateSerialFraction([{ instances: 1, capacity: bracketed(100) }])).toBeNull();
    expect(calibrateSerialFraction([{ instances: 1, capacity: bracketed(100) }, { instances: 2, capacity: lowerBound }])).toBeNull();
    expect(calibrateSerialFraction([{ instances: 2, capacity: bracketed(100) }, { instances: 2, capacity: bracketed(110) }])).toBeNull();
  });
});