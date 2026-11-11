import { describe, it, expect } from "vitest";
import {
  HttpRequestSchema,
  WorkflowSchema,
  LoadScenarioSchema,
  ThresholdSchema,
  AssertionSchema,
} from "@/shared/schemas";

const step = (id: string) => ({
  id,
  name: id,
  request: { method: "GET", url: "http://localhost/{{path}}" },
});

describe("HttpRequestSchema", () => {
  it("applique les valeurs par défaut", () => {
    const r = HttpRequestSchema.parse({ method: "GET", url: "http://localhost" });
    expect(r.body).toEqual({ type: "none" });
    expect(r.auth).toEqual({ type: "none" });
    expect(r.followRedirects).toBe(true);
    expect(r.params).toEqual([]);
  });

  it("refuse une méthode inconnue", () => {
    expect(HttpRequestSchema.safeParse({ method: "FETCH", url: "http://x" }).success).toBe(false);
  });
});

describe("WorkflowSchema", () => {
  it("refuse des identifiants d'étape dupliqués", () => {
    const r = WorkflowSchema.safeParse({ name: "w", steps: [step("a"), step("a")] });
    expect(r.success).toBe(false);
  });

  it("accepte des étapes valides", () => {
    const r = WorkflowSchema.safeParse({ name: "w", steps: [step("a"), step("b")] });
    expect(r.success).toBe(true);
  });
});

describe("AssertionSchema", () => {
  it("exige une valeur pour l'opérateur equals", () => {
    const r = AssertionSchema.safeParse({ type: "jsonPath", path: "$.id", operator: "equals" });
    expect(r.success).toBe(false);
  });

  it("n'exige pas de valeur pour exists", () => {
    const r = AssertionSchema.safeParse({ type: "jsonPath", path: "$.id", operator: "exists" });
    expect(r.success).toBe(true);
  });
});

describe("ThresholdSchema", () => {
  it.each(["p(95)<500", "rate<0.01", "avg<=200", "p(99.9)<1000", "count>1000"])("accepte %s", (expression) => {
    expect(ThresholdSchema.safeParse({ metric: "http_req_duration", expression }).success).toBe(true);
  });

  it.each(["p(95) 500", "foo<1", "p(95)<", "p(100)<5"])("refuse %s", (expression) => {
    expect(ThresholdSchema.safeParse({ metric: "http_req_duration", expression }).success).toBe(false);
  });
});

describe("LoadScenarioSchema", () => {
  const workflow = { name: "w", steps: [step("a")] };

  it("refuse preAllocatedVus > maxVus", () => {
    const r = LoadScenarioSchema.safeParse({
      name: "t",
      workflow,
      executor: {
        type: "constant-arrival-rate",
        rate: 10,
        durationSeconds: 10,
        preAllocatedVus: 20,
        maxVus: 10,
      },
    });
    expect(r.success).toBe(false);
  });

  it("applique les valeurs par défaut des executors", () => {
    const r = LoadScenarioSchema.parse({
      name: "t",
      workflow,
      executor: { type: "ramping-vus", stages: [{ durationSeconds: 10, target: 5 }] },
    });
    expect(r.thresholds).toEqual([]);
    if (r.executor.type === "ramping-vus") expect(r.executor.startVus).toBe(0);
  });
});