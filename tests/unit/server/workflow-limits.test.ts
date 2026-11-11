import { describe, it, expect } from "vitest";
import { buildLimits } from "@/server/config/limits";
import { parseEnv } from "@/server/config/env.schema";
import { assertWorkflowWithinLimits } from "@/server/config/enforce-limits";
import { WorkflowSchema } from "@/shared/schemas";

const limits = buildLimits(parseEnv({ WORKFLOW_MAX_STEPS: "3", WORKFLOW_MAX_DURATION_SECONDS: "120" }));
const step = (id: string, thinkTimeMs = 0) => ({
  id,
  name: id,
  request: { method: "GET", url: "http://x.test/" },
  thinkTimeMs,
});
const wf = (steps: unknown[]) => WorkflowSchema.parse({ name: "w", steps });

describe("assertWorkflowWithinLimits", () => {
  it("accepte un workflow dans les limites", () => {
    expect(() => assertWorkflowWithinLimits(wf([step("a"), step("b")]), limits)).not.toThrow();
  });

  it("refuse trop d'étapes", () => {
    const steps = ["a", "b", "c", "d"].map((id) => step(id));
    expect(() => assertWorkflowWithinLimits(wf(steps), limits)).toThrow(/limites/);
  });

  it("refuse des pauses cumulées supérieures à la durée maximale", () => {
    const steps = ["a", "b", "c"].map((id) => step(id, 50_000)); // 150 s
    expect(() => assertWorkflowWithinLimits(wf(steps), limits)).toThrow(/limites/);
  });
});