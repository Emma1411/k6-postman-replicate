import { describe, it, expect } from "vitest";
import { ArrivalSchedule, ownedVuCount, rampingTarget } from "@/server/engine/executors/schedule";

function drainSchedule(schedule: ArrivalSchedule): number[] {
  const out: number[] = [];
  for (let t = schedule.next(); t !== null; t = schedule.next()) out.push(t);
  return out;
}

describe("ownedVuCount", () => {
  it("répartit les VUs en tourniquet", () => {
    expect([0, 1, 2].map((i) => ownedVuCount(10, i, 3))).toEqual([4, 3, 3]);
    expect([0, 1, 2, 3].map((i) => ownedVuCount(3, i, 4))).toEqual([1, 1, 1, 0]);
    expect([0, 1].map((i) => ownedVuCount(0, i, 2))).toEqual([0, 0]);
    expect(ownedVuCount(7, 0, 1)).toBe(7);
  });

  it("couvre exactement la cible", () => {
    for (const [target, count] of [[1, 4], [17, 5], [100, 8]]) {
      const sum = Array.from({ length: count }, (_, i) => ownedVuCount(target, i, count)).reduce((a, b) => a + b, 0);
      expect(sum).toBe(target);
    }
  });
});

describe("rampingTarget", () => {
  const stages = [
    { durationSeconds: 10, target: 10 },
    { durationSeconds: 10, target: 0 },
  ];

  it("interpole linéairement entre les stages", () => {
    expect(rampingTarget(0, stages, 0)).toBe(0);
    expect(rampingTarget(0, stages, 5)).toBe(5);
    expect(rampingTarget(0, stages, 10)).toBe(10);
    expect(rampingTarget(0, stages, 15)).toBe(5);
    expect(rampingTarget(0, stages, 25)).toBe(0);
  });

  it("part de la valeur initiale", () => {
    expect(rampingTarget(4, [{ durationSeconds: 10, target: 14 }], 5)).toBe(9);
  });
});

describe("ArrivalSchedule", () => {
  it("génère une cadence constante", () => {
    const times = drainSchedule(ArrivalSchedule.constant(10, 1, 2));
    expect(times).toHaveLength(20);
    expect(times[0]).toBeCloseTo(0.1, 9);
    expect(times[1]).toBeCloseTo(0.2, 9);
    expect(times[19]).toBeCloseTo(2, 9);
  });

  it("tient compte de l'unité de temps", () => {
    // 10 itérations par 2 secondes = 5 par seconde
    const times = drainSchedule(ArrivalSchedule.constant(10, 2, 2));
    expect(times).toHaveLength(10);
    expect(times[0]).toBeCloseTo(0.2, 9);
    expect(times[9]).toBeCloseTo(2, 9);
  });

  it("monte progressivement : 0 → 10/s sur 10 s", () => {
    const times = drainSchedule(new ArrivalSchedule(0, [{ durationSeconds: 10, target: 10 }], 1));
    expect(times).toHaveLength(50); // aire du triangle
    expect(times[0]).toBeCloseTo(Math.SQRT2, 6); // 0,5·τ² = 1
    expect(times[49]).toBeCloseTo(10, 6);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("descend progressivement : 10/s → 0 sur 10 s", () => {
    const times = drainSchedule(new ArrivalSchedule(10, [{ durationSeconds: 10, target: 0 }], 1));
    expect(times).toHaveLength(50);
    expect(times[0]).toBeCloseTo(0.100505, 5);
    expect(times[49]).toBeCloseTo(10, 6);
  });

  it("enchaîne plusieurs stages", () => {
    // montée 0 → 10/s en 5 s (25 arrivées), puis plateau à 10/s pendant 5 s (50 arrivées)
    const times = drainSchedule(
      new ArrivalSchedule(
        0,
        [
          { durationSeconds: 5, target: 10 },
          { durationSeconds: 5, target: 10 },
        ],
        1,
      ),
    );
    expect(times).toHaveLength(75);
    expect(times[24]).toBeCloseTo(5, 6);
    expect(times[74]).toBeCloseTo(10, 6);
  });

  it("ne produit rien quand la cadence est nulle", () => {
    expect(drainSchedule(new ArrivalSchedule(0, [{ durationSeconds: 10, target: 0 }], 1))).toEqual([]);
  });

  it("convertit les cadences par minute", () => {
    // 60 par minute = 1 par seconde
    const times = drainSchedule(ArrivalSchedule.constant(60, 60, 5));
    expect(times).toHaveLength(5);
    expect(times[0]).toBeCloseTo(1, 9);
  });
});