import { describe, it, expect } from "vitest";
import { erlangC, mmcQueue } from "@/shared/advisor/capacity/erlang";

describe("erlangC", () => {
  it("retrouve les valeurs connues", () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 10); // M/M/1 : P(attente) = ρ
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 10);
    expect(erlangC(4, 2)).toBeCloseTo(0.17391, 4);
  });

  it("borne les cas limites", () => {
    expect(erlangC(3, 0)).toBe(0);
    expect(erlangC(3, 3)).toBe(1);
    expect(erlangC(3, 5)).toBe(1);
  });

  it("reste stable avec beaucoup de serveurs", () => {
    const c = erlangC(256, 200);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(0.01);
  });
});

describe("mmcQueue", () => {
  it("retrouve les formules exactes de M/M/1", () => {
    // μ = 100/s (10 ms), λ = 50/s : ρ = 0,5, attente moyenne = ρ/(μ−λ) = 10 ms
    const q = mmcQueue({ servers: 1, serviceMs: 10, arrivalPerSec: 50 });
    expect(q.stable).toBe(true);
    expect(q.utilization).toBeCloseTo(0.5, 10);
    expect(q.meanWaitMs).toBeCloseTo(10, 6);
    // P(W > t) = ρ·e^{−(μ−λ)t} : quantile 95 = ln(ρ/0,05)/(μ−λ) = ln(10)/50 s
    expect(q.waitP95Ms).toBeCloseTo((Math.log(10) / 50) * 1000, 6);
  });

  it("déclare instable une file saturée", () => {
    const q = mmcQueue({ servers: 2, serviceMs: 10, arrivalPerSec: 200 });
    expect(q.stable).toBe(false);
    expect(q.waitP95Ms).toBe(Infinity);
  });

  it("ne fait pas attendre sans trafic ni quand la probabilité d'attente est faible", () => {
    expect(mmcQueue({ servers: 4, serviceMs: 10, arrivalPerSec: 0 }).waitP95Ms).toBe(0);
    expect(mmcQueue({ servers: 16, serviceMs: 10, arrivalPerSec: 200 }).waitP95Ms).toBe(0);
  });

  it("réduit l'attente quand le temps de service est plus régulier", () => {
    const exp = mmcQueue({ servers: 1, serviceMs: 10, arrivalPerSec: 50, variability: 1 });
    const det = mmcQueue({ servers: 1, serviceMs: 10, arrivalPerSec: 50, variability: 0 });
    expect(det.meanWaitMs).toBeCloseTo(exp.meanWaitMs / 2, 6); // M/D/1 : moitié de M/M/1
  });

  it("augmente fortement l'attente près de la saturation", () => {
    const light = mmcQueue({ servers: 2, serviceMs: 10, arrivalPerSec: 100 });
    const heavy = mmcQueue({ servers: 2, serviceMs: 10, arrivalPerSec: 190 });
    expect(heavy.waitP95Ms).toBeGreaterThan(light.waitP95Ms * 10);
  });
});