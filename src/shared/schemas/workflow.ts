import { z } from "zod";
import { JsonPrimitiveSchema, VariableNameSchema, VariablesSchema } from "./common";
import { HttpRequestSchema } from "./http";

const NumberOperator = z.enum(["lt", "lte", "gt", "gte"]);
const StatusCode = z.number().int().min(100).max(599);
const label = z.string().max(200).optional();

const StatusAssertion = z.object({
  label,
  type: z.literal("status"),
  expected: z.union([StatusCode, z.array(StatusCode).min(1).max(20)]),
});

const ResponseTimeAssertion = z.object({
  label,
  type: z.literal("responseTime"),
  operator: NumberOperator,
  valueMs: z.number().positive(),
});

const HeaderAssertion = z.object({
  label,
  type: z.literal("header"),
  headerName: z.string().min(1).max(256),
  operator: z.enum(["exists", "notExists", "equals", "contains", "matches"]),
  value: z.string().max(1024).optional(),
});

const JsonPathAssertion = z.object({
  label,
  type: z.literal("jsonPath"),
  path: z.string().min(1).max(512),
  operator: z.enum([
    "exists",
    "notExists",
    "equals",
    "notEquals",
    "contains",
    "matches",
    "gt",
    "gte",
    "lt",
    "lte",
    "type", // value = "string" | "number" | "boolean" | "object" | "array" | "null"
  ]),
  value: JsonPrimitiveSchema.optional(),
});

const BodyContainsAssertion = z.object({
  label,
  type: z.literal("bodyContains"),
  value: z.string().min(1).max(1024),
});

const JsonSchemaAssertion = z.object({
  label,
  type: z.literal("jsonSchema"),
  schema: z.record(z.string(), z.unknown()),
});

export const AssertionSchema = z
  .discriminatedUnion("type", [
    StatusAssertion,
    ResponseTimeAssertion,
    HeaderAssertion,
    JsonPathAssertion,
    BodyContainsAssertion,
    JsonSchemaAssertion,
  ])
  .superRefine((a, ctx) => {
    if (
      (a.type === "header" || a.type === "jsonPath") &&
      a.operator !== "exists" &&
      a.operator !== "notExists" &&
      a.value === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `L'opérateur "${a.operator}" exige une valeur.`,
      });
    }
  });
export type Assertion = z.infer<typeof AssertionSchema>;

export const ExtractorSchema = z.discriminatedUnion("from", [
  z.object({ variable: VariableNameSchema, from: z.literal("jsonPath"), path: z.string().min(1).max(512) }),
  z.object({ variable: VariableNameSchema, from: z.literal("header"), headerName: z.string().min(1).max(256) }),
  z.object({
    variable: VariableNameSchema,
    from: z.literal("regex"),
    pattern: z.string().min(1).max(512),
    group: z.number().int().min(0).max(20).default(1),
  }),
  z.object({ variable: VariableNameSchema, from: z.literal("status") }),
]);
export type Extractor = z.infer<typeof ExtractorSchema>;

export const ConditionSchema = z.object({
  left: z.string().min(1).max(512), // peut contenir des {{variables}}
  operator: z.enum(["exists", "notExists", "equals", "notEquals", "contains", "gt", "gte", "lt", "lte"]),
  right: z.string().max(512).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Identifiant d'étape invalide"),
  name: z.string().min(1).max(200),
  request: HttpRequestSchema,
  extract: z.array(ExtractorSchema).max(50).default([]),
  assertions: z.array(AssertionSchema).max(50).default([]),
  runIf: ConditionSchema.optional(),
  onError: z.enum(["stop", "continue"]).default("stop"),
  thinkTimeMs: z.number().int().min(0).max(60_000).default(0),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowSchema = z
  .object({
    name: z.string().min(1).max(200),
    variables: VariablesSchema.default({}),
    // Plafond de sécurité du schéma. La limite réelle vient de WORKFLOW_MAX_STEPS.
    steps: z.array(WorkflowStepSchema).min(1).max(200),
  })
  .superRefine((w, ctx) => {
    const seen = new Set<string>();
    w.steps.forEach((s, i) => {
      if (seen.has(s.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "id"],
          message: `Identifiant d'étape dupliqué : ${s.id}`,
        });
      }
      seen.add(s.id);
    });
  });
export type Workflow = z.infer<typeof WorkflowSchema>;

export const RunWorkflowInputSchema = z.object({
  workflow: WorkflowSchema,
  variables: VariablesSchema.default({}),
});
export type RunWorkflowInput = z.infer<typeof RunWorkflowInputSchema>;