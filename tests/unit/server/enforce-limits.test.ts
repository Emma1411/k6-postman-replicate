import { describe, it, expect } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { assertScenarioWithinLimits } from "@/server/config/enforce-limits";
import { AppError } from "@/server/utils/errors";
import { LoadScenarioSchema } from "@/shared/schemas";

const limits = buildLimits(parseEnv({}));

const workflow = {
  name: "w",
  steps: [{ id: "s1", name: "get", request: { method: "GET", url: "http://localhost/" } }],
};

function scenario(executor: unknown) {
  return LoadScenarioSchema.parse({ name: "t", workflow, executor });
}

function violationsOf(fn: () => void): string[] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);

    const error = e as AppError;

    expect(error.code).toBe("LIMIT_EXCEEDED");

    const details = error.details as { violations: string[] };

    return details.violations;
  }

  return [];
}

describe("assertScenarioWithinLimits", () => {
  it("accepte un scénario dans les limites", () => {
    const s = scenario({ type: "constant-vus", vus: 10, durationSeconds: 30 });
    expect(() => assertScenarioWithinLimits(s, limits)).not.toThrow();
  });

  it("refuse trop de VUs", () => {
    const s = scenario({ type: "constant-vus", vus: 101, durationSeconds: 30 });
    const v = violationsOf(() => assertScenarioWithinLimits(s, limits));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/VUs/);
  });

  it("additionne la durée des stages", () => {
    const s = scenario({
      type: "ramping-vus",
      stages: [
        { durationSeconds: 60, target: 50 },
        { durationSeconds: 80, target: 100 },
      ],
    });
    const v = violationsOf(() => assertScenarioWithinLimits(s, limits));
    expect(v.some((x) => x.startsWith("Durée"))).toBe(true);
  });

  it("borne le débit des executors à cadence imposée", () => {
    const s = scenario({
      type: "constant-arrival-rate",
      rate: 600,
      durationSeconds: 10,
      preAllocatedVus: 10,
      maxVus: 50,
    });
    const v = violationsOf(() => assertScenarioWithinLimits(s, limits));
    expect(v.some((x) => x.startsWith("Débit"))).toBe(true);
  });

  it("liste toutes les violations en une fois", () => {
    const s = scenario({ type: "constant-vus", vus: 500, durationSeconds: 1000 });
    const v = violationsOf(() => assertScenarioWithinLimits(s, limits));
    expect(v).toHaveLength(2);
  });
});