import { describe, it, expect } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { checkExecutorAgainstLimits } from "@/server/config/enforce-limits";
import { buildLimits } from "@/server/config/limits";
import { ExecutorSchema } from "@/shared/schemas";

const executor = (rate: number, maxVus: number, durationSeconds: number) =>
  ExecutorSchema.parse({
    type: "ramping-arrival-rate",
    startRate: 10,
    stages: [{ durationSeconds, target: rate }],
    preAllocatedVus: 5,
    maxVus,
  });

describe("checkExecutorAgainstLimits", () => {
  const limits = buildLimits(parseEnv({}));

  it("signale tous les dépassements des limites par défaut", () => {
    const v = checkExecutorAgainstLimits(executor(600, 500, 300), 1, limits);
    expect(v).toHaveLength(3);
    expect(v.join(" ")).toContain("VUs : 500 > 100");
    expect(v.join(" ")).toContain("Durée : 300s > 120s");
    expect(v.join(" ")).toContain("Débit : 600 req/s > 500 req/s");
  });

  it("tient compte du nombre de requêtes par itération", () => {
    expect(checkExecutorAgainstLimits(executor(200, 50, 60), 1, limits)).toEqual([]);
    expect(checkExecutorAgainstLimits(executor(200, 50, 60), 3, limits)).toEqual(["Débit : 600 req/s > 500 req/s"]);
  });

  it("accepte un plan dans les limites relevées", () => {
    const big = buildLimits(parseEnv({ LOAD_MAX_RPS: "2000", LOAD_MAX_VUS: "1000", LOAD_MAX_DURATION_SECONDS: "600" }));
    expect(checkExecutorAgainstLimits(executor(600, 500, 300), 1, big)).toEqual([]);
  });
});