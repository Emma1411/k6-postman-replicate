import { describe, it, expect } from "vitest";
import { Histogram, HISTOGRAM_MAX_VALUE } from "@/server/engine/metrics/histogram";

describe("Histogram", () => {
  it("est vide au départ", () => {
    const h = new Histogram();
    expect(h.count).toBe(0);
    expect(h.valueAtPercentile(95)).toBe(0);
    expect(h.toSnapshot()).toEqual({ sparse: [], count: 0, sum: 0, min: 0, max: 0 });
  });

  it("est exact pour les petites valeurs", () => {
    const h = new Histogram();
    for (let v = 1; v <= 1000; v++) h.record(v);
    expect(h.count).toBe(1000);
    expect(h.min).toBe(1);
    expect(h.max).toBe(1000);
    expect(h.sum / h.count).toBe(500.5);
    expect(h.valueAtPercentile(50)).toBe(500);
    expect(h.valueAtPercentile(90)).toBe(900);
    expect(h.valueAtPercentile(99)).toBe(990);
    expect(h.valueAtPercentile(100)).toBe(1000);
  });

  it("garde une erreur relative sous 0,2 % sur les grandes valeurs", () => {
    const h = new Histogram();
    for (let i = 1; i <= 10_000; i++) h.record(i * 1000); // de 1 ms à 10 s, en µs
    for (const [p, expected] of [
      [50, 5_000_000],
      [95, 9_500_000],
      [99, 9_900_000],
    ] as const) {
      const got = h.valueAtPercentile(p);
      expect(got).toBeGreaterThanOrEqual(expected); // une case renvoie sa borne haute
      expect(Math.abs(got - expected) / expected).toBeLessThan(0.002);
    }
  });

  it("ne dépasse jamais les valeurs observées", () => {
    const h = new Histogram();
    h.record(123_456);
    expect(h.valueAtPercentile(50)).toBe(123_456);
    expect(h.valueAtPercentile(99.9)).toBe(123_456);
  });

  it("borne les valeurs hors limites", () => {
    const h = new Histogram();
    h.record(-5);
    h.record(HISTOGRAM_MAX_VALUE * 2);
    expect(h.count).toBe(2);
    expect(h.min).toBe(0);
    expect(h.max).toBe(HISTOGRAM_MAX_VALUE);
  });

  it("produit un instantané creux", () => {
    const h = new Histogram();
    h.record(5);
    h.record(5);
    h.record(7);
    expect(h.toSnapshot().sparse).toEqual([5, 2, 7, 1]);
  });

  it("fusionne des instantanés, y compris vides", () => {
    const a = new Histogram();
    const b = new Histogram();
    [100, 200, 300].forEach((v) => a.record(v));
    [400, 500].forEach((v) => b.record(v));

    const merged = new Histogram();
    merged.mergeSnapshot(a.toSnapshot());
    merged.mergeSnapshot(b.toSnapshot());
    merged.mergeSnapshot(new Histogram().toSnapshot());

    expect(merged.count).toBe(5);
    expect(merged.sum).toBe(1500);
    expect(merged.min).toBe(100);
    expect(merged.max).toBe(500);
    expect(merged.valueAtPercentile(50)).toBe(300);
  });

  it("se remet à zéro", () => {
    const h = new Histogram();
    h.record(10);
    h.reset();
    expect(h.count).toBe(0);
    expect(h.toSnapshot().sparse).toEqual([]);
    h.record(20);
    expect(h.min).toBe(20);
  });
});