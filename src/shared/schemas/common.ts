import { z } from "zod";

export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const VariableNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/, "Nom de variable invalide");

export const VariablesSchema = z.record(VariableNameSchema, z.string().max(16_384));
export type Variables = z.infer<typeof VariablesSchema>;

export const KeyValueSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.string().max(8192),
  enabled: z.boolean().default(true),
});
export type KeyValue = z.infer<typeof KeyValueSchema>;

export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>;