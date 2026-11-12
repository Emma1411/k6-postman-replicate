import { describe, it, expect } from "vitest";
import { chooseWorkerCount } from "@/server/engine/runs/load-run";
import { ExecutorSchema } from "@/shared/schemas";

const count = (executor: unknown, max: number) => chooseWorkerCount(ExecutorSchema.parse(executor), max);

describe("chooseWorkerCount", () => {
  it("ne dépasse ni le maximum ni le nombre de VUs", () => {
    expect(count({ type: "constant-vus", vus: 1, durationSeconds: 10 }, 4)).toBe(1);
    expect(count({ type: "constant-vus", vus: 10, durationSeconds: 10 }, 4)).toBe(4);
    expect(count({ type: "constant-vus", vus: 10, durationSeconds: 10 }, 1)).toBe(1);
  });

  it("utilise le maximum de VUs pour les executors à cadence", () => {
    const e = { type: "constant-arrival-rate", rate: 100, durationSeconds: 10, preAllocatedVus: 2, maxVus: 3 };
    expect(count(e, 8)).toBe(3);
  });

  it("utilise le pic des stages pour ramping-vus", () => {
    const e = { type: "ramping-vus", stages: [{ durationSeconds: 5, target: 6 }, { durationSeconds: 5, target: 2 }] };
    expect(count(e, 8)).toBe(6);
  });
});