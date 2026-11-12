import { z } from "zod";
import { WorkflowSchema } from "./workflow";

const Stage = z.object({
  durationSeconds: z.number().int().min(1).max(86_400),
  target: z.number().int().min(0).max(1_000_000),
});

const ConstantVus = z.object({
  type: z.literal("constant-vus"),
  vus: z.number().int().min(1),
  durationSeconds: z.number().int().min(1),
});

const RampingVus = z.object({
  type: z.literal("ramping-vus"),
  startVus: z.number().int().min(0).default(0),
  stages: z.array(Stage).min(1).max(50),
});

const ConstantArrivalRate = z.object({
  type: z.literal("constant-arrival-rate"),
  rate: z.number().int().min(1),
  timeUnitSeconds: z.number().int().min(1).default(1),
  durationSeconds: z.number().int().min(1),
  preAllocatedVus: z.number().int().min(1),
  maxVus: z.number().int().min(1),
});

const RampingArrivalRate = z.object({
  type: z.literal("ramping-arrival-rate"),
  startRate: z.number().int().min(0).default(0),
  timeUnitSeconds: z.number().int().min(1).default(1),
  stages: z.array(Stage).min(1).max(50),
  preAllocatedVus: z.number().int().min(1),
  maxVus: z.number().int().min(1),
});

const PerVuIterations = z.object({
  type: z.literal("per-vu-iterations"),
  vus: z.number().int().min(1),
  iterations: z.number().int().min(1),
  maxDurationSeconds: z.number().int().min(1).default(600),
});

const SharedIterations = z.object({
  type: z.literal("shared-iterations"),
  vus: z.number().int().min(1),
  iterations: z.number().int().min(1),
  maxDurationSeconds: z.number().int().min(1).default(600),
});

export const ExecutorSchema = z.discriminatedUnion("type", [
  ConstantVus,
  RampingVus,
  ConstantArrivalRate,
  RampingArrivalRate,
  PerVuIterations,
  SharedIterations,
]);
export type ExecutorConfig = z.infer<typeof ExecutorSchema>;

export const LOAD_METRICS = [
  "http_req_duration",
  "http_req_failed",
  "http_reqs",
  "iterations",
  "iteration_duration",
  "dropped_iterations",
  "checks",
  "vus",
  "data_sent",
  "data_received",
] as const;
export type LoadMetricName = (typeof LOAD_METRICS)[number];

// Exemples : p(95)<500 · rate<0.01 · avg<=200 · count>1000
export const THRESHOLD_EXPRESSION =
  /^(avg|min|max|med|count|rate|value|p\(\d{1,2}(\.\d+)?\))\s*(<=|>=|==|!=|<|>)\s*-?\d+(\.\d+)?$/;

export const ThresholdSchema = z.object({
  metric: z.enum(LOAD_METRICS),
  expression: z.string().regex(THRESHOLD_EXPRESSION, "Expression de threshold invalide"),
  abortOnFail: z.boolean().default(false),
  delayAbortEvalSeconds: z.number().int().min(0).max(3600).default(0),
});
export type Threshold = z.infer<typeof ThresholdSchema>;

export const LoadScenarioSchema = z
  .object({
    name: z.string().min(1).max(200),
    workflow: WorkflowSchema,
    executor: ExecutorSchema,
    thresholds: z.array(ThresholdSchema).max(50).default([]),
  })
  .superRefine((s, ctx) => {
    const e = s.executor;
    if (
      (e.type === "constant-arrival-rate" || e.type === "ramping-arrival-rate") &&
      e.preAllocatedVus > e.maxVus
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["executor", "preAllocatedVus"],
        message: "preAllocatedVus ne peut pas dépasser maxVus.",
      });
    }
  });
export type LoadScenario = z.infer<typeof LoadScenarioSchema>;

export const RunLoadTestInputSchema = z.object({ scenario: LoadScenarioSchema });
export type RunLoadTestInput = z.infer<typeof RunLoadTestInputSchema>;