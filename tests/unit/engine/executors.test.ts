import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExecutor } from "@/server/engine/executors/run-executor";
import { sleep } from "@/server/engine/executors/timing";
import type { IterationFn } from "@/server/engine/executors/types";
import { ExecutorSchema } from "@/shared/schemas";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

interface Options {
  iterationMs?: number;
  shareIndex?: number;
  shareCount?: number;
  gracefulStopMs?: number;
}

function harness(executor: unknown, options: Options = {}) {
  const starts: Array<{ vu: number; iteration: number; at: number }> = [];
  const vusLog: number[] = [];
  const state = { dropped: 0, inFlight: 0, maxInFlight: 0 };
  const controller = new AbortController();
  const startAtMs = Date.now();

  const runIteration: IterationFn = async ({ vu, iteration }) => {
    starts.push({ vu, iteration, at: Date.now() });
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await sleep(options.iterationMs ?? 100, controller.signal);
    state.inFlight--;
  };

  const done = runExecutor({
    executor: ExecutorSchema.parse(executor),
    startAtMs,
    shareIndex: options.shareIndex ?? 0,
    shareCount: options.shareCount ?? 1,
    runIteration,
    recorder: {
      setVus: (n) => vusLog.push(n),
      recordDropped: (n) => {
        state.dropped += n;
      },
    },
    controller,
    gracefulStopMs: options.gracefulStopMs,
  });

  return { starts, vusLog, state, controller, done, startAtMs };
}

describe("constant-vus", () => {
  it("fait tourner les VUs pendant la durée demandée", async () => {
    const h = harness({ type: "constant-vus", vus: 3, durationSeconds: 10 }, { iterationMs: 1000 });
    await vi.advanceTimersByTimeAsync(12_000);
    await h.done;

    expect(new Set(h.starts.map((s) => s.vu))).toEqual(new Set([1, 2, 3]));
    expect(h.starts.length).toBeGreaterThanOrEqual(30);
    expect(h.starts.length).toBeLessThanOrEqual(33);
    expect(h.vusLog[0]).toBe(3);
    expect(h.vusLog.at(-1)).toBe(0);
  });

  it("se répartit entre les workers selon le numéro de VU", async () => {
    const w0 = harness({ type: "constant-vus", vus: 4, durationSeconds: 5 }, { shareIndex: 0, shareCount: 2 });
    const w1 = harness({ type: "constant-vus", vus: 4, durationSeconds: 5 }, { shareIndex: 1, shareCount: 2 });
    await vi.advanceTimersByTimeAsync(7000);
    await Promise.all([w0.done, w1.done]);

    expect(new Set(w0.starts.map((s) => s.vu))).toEqual(new Set([1, 3]));
    expect(new Set(w1.starts.map((s) => s.vu))).toEqual(new Set([2, 4]));
  });

  it("s'arrête quand le test est annulé", async () => {
    const h = harness({ type: "constant-vus", vus: 2, durationSeconds: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    h.controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    await h.done;
    const count = h.starts.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.starts.length).toBe(count);
  });

  it("annule de force les itérations qui dépassent le délai d'arrêt progressif", async () => {
    const h = harness(
      { type: "constant-vus", vus: 1, durationSeconds: 5 },
      { iterationMs: 60_000, gracefulStopMs: 2000 },
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2500);
    await h.done;
    expect(h.controller.signal.aborted).toBe(true);
  });
});

describe("ramping-vus", () => {
  it("monte puis descend selon les stages", async () => {
    const h = harness(
      {
        type: "ramping-vus",
        stages: [
          { durationSeconds: 10, target: 10 },
          { durationSeconds: 10, target: 0 },
        ],
      },
      { iterationMs: 500 },
    );
    await vi.advanceTimersByTimeAsync(25_000);
    await h.done;

    const peak = Math.max(...h.vusLog);
    const peakAt = h.vusLog.indexOf(peak);
    expect(peak).toBe(10);
    expect(h.vusLog.at(-1)).toBe(0);
    for (let i = 1; i <= peakAt; i++) expect(h.vusLog[i]).toBeGreaterThanOrEqual(h.vusLog[i - 1]);
    for (let i = peakAt + 1; i < h.vusLog.length - 1; i++) expect(h.vusLog[i]).toBeLessThanOrEqual(h.vusLog[i - 1]);
  });

  it("relance un VU en cours d'arrêt si la cible remonte", async () => {
    const h = harness(
      {
        type: "ramping-vus",
        startVus: 4,
        stages: [
          { durationSeconds: 2, target: 1 },
          { durationSeconds: 2, target: 4 },
        ],
      },
      { iterationMs: 10_000, gracefulStopMs: 20_000 },
    );
    await vi.advanceTimersByTimeAsync(5000);
    h.controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    await h.done;
    // chaque VU a démarré une seule fois : aucun doublon d'identifiant
    expect(h.starts.map((s) => s.vu).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("constant-arrival-rate", () => {
  it("lance les itérations à la cadence demandée", async () => {
    const h = harness({
      type: "constant-arrival-rate",
      rate: 10,
      durationSeconds: 5,
      preAllocatedVus: 2,
      maxVus: 4,
    });
    await vi.advanceTimersByTimeAsync(6000);
    await h.done;

    expect(h.starts).toHaveLength(50);
    expect(h.state.dropped).toBe(0);
    expect(h.starts[0].at - h.startAtMs).toBe(100);
    expect(h.starts[49].at - h.startAtMs).toBe(5000);
    expect(h.vusLog[0]).toBe(2);
    expect(Math.max(...h.vusLog)).toBeLessThanOrEqual(4);
  });

  it("abandonne les itérations quand tous les VUs sont occupés", async () => {
    const h = harness(
      { type: "constant-arrival-rate", rate: 10, durationSeconds: 5, preAllocatedVus: 1, maxVus: 2 },
      { iterationMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(8000);
    await h.done;

    expect(h.starts.length + h.state.dropped).toBe(50);
    expect(h.state.dropped).toBeGreaterThan(30);
    expect(h.state.maxInFlight).toBeLessThanOrEqual(2);
  });

  it("répartit les itérations entre les workers sans doublon ni trou", async () => {
    const config = { type: "constant-arrival-rate", rate: 10, durationSeconds: 5, preAllocatedVus: 2, maxVus: 4 };
    const w0 = harness(config, { shareIndex: 0, shareCount: 2 });
    const w1 = harness(config, { shareIndex: 1, shareCount: 2 });
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all([w0.done, w1.done]);

    const all = [...w0.starts, ...w1.starts].map((s) => s.iteration).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(w0.starts).toHaveLength(25);
    expect(new Set(w0.starts.map((s) => s.vu)).size).toBeGreaterThan(0);
  });
});

describe("ramping-arrival-rate", () => {
  it("suit la rampe demandée", async () => {
    const h = harness({
      type: "ramping-arrival-rate",
      startRate: 0,
      stages: [{ durationSeconds: 10, target: 10 }],
      preAllocatedVus: 5,
      maxVus: 20,
    });
    await vi.advanceTimersByTimeAsync(12_000);
    await h.done;

    expect(h.starts).toHaveLength(50);
    // à mi-parcours, la cadence est la moitié : 12 itérations dans les 5 premières secondes (aire = 12,5)
    const firstHalf = h.starts.filter((s) => s.at - h.startAtMs <= 5000).length;
    expect(firstHalf).toBe(12);
  });
});

describe("per-vu-iterations", () => {
  it("exécute le nombre d'itérations demandé par VU", async () => {
    const h = harness({ type: "per-vu-iterations", vus: 3, iterations: 4, maxDurationSeconds: 60 });
    await vi.advanceTimersByTimeAsync(2000);
    await h.done;

    expect(h.starts).toHaveLength(12);
    for (const vu of [1, 2, 3]) {
      const own = h.starts.filter((s) => s.vu === vu);
      expect(own.map((s) => s.iteration)).toEqual([1, 2, 3, 4]);
    }
  });

  it("s'arrête à la durée maximale", async () => {
    const h = harness({ type: "per-vu-iterations", vus: 2, iterations: 1000, maxDurationSeconds: 3 });
    await vi.advanceTimersByTimeAsync(5000);
    await h.done;

    expect(h.starts.length).toBeGreaterThanOrEqual(56);
    expect(h.starts.length).toBeLessThanOrEqual(62);
    expect(h.starts.every((s) => s.at - h.startAtMs <= 3000)).toBe(true);
  });
});

describe("shared-iterations", () => {
  it("exécute exactement le nombre total d'itérations", async () => {
    const h = harness({ type: "shared-iterations", vus: 3, iterations: 10, maxDurationSeconds: 60 });
    await vi.advanceTimersByTimeAsync(2000);
    await h.done;
    expect(h.starts).toHaveLength(10);
    expect(new Set(h.starts.map((s) => s.vu))).toEqual(new Set([1, 2, 3]));
  });

  it("répartit le total entre les workers", async () => {
    const config = { type: "shared-iterations", vus: 4, iterations: 7, maxDurationSeconds: 60 };
    const w0 = harness(config, { shareIndex: 0, shareCount: 2 });
    const w1 = harness(config, { shareIndex: 1, shareCount: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([w0.done, w1.done]);
    expect(w0.starts).toHaveLength(4);
    expect(w1.starts).toHaveLength(3);
  });

  it("ne perd aucune itération quand un worker n'a pas de VU", async () => {
    const config = { type: "shared-iterations", vus: 1, iterations: 5, maxDurationSeconds: 60 };
    const w0 = harness(config, { shareIndex: 0, shareCount: 2 });
    const w1 = harness(config, { shareIndex: 1, shareCount: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([w0.done, w1.done]);
    expect(w0.starts).toHaveLength(5);
    expect(w1.starts).toHaveLength(0);
  });
});