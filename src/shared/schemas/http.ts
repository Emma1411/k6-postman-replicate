import { z } from "zod";
import { HttpMethodSchema, KeyValueSchema, VariablesSchema } from "./common";

const NoBody = z.object({ type: z.literal("none") });
const JsonBody = z.object({ type: z.literal("json"), content: z.string() });
const XmlBody = z.object({ type: z.literal("xml"), content: z.string() });
const RawBody = z.object({
  type: z.literal("raw"),
  content: z.string(),
  contentType: z.string().max(256).default("text/plain"),
});
const UrlEncodedBody = z.object({
  type: z.literal("urlencoded"),
  fields: z.array(KeyValueSchema).max(100),
});

const FormDataField = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    key: z.string().min(1).max(256),
    value: z.string().max(8192),
    enabled: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("file"),
    key: z.string().min(1).max(256),
    filename: z.string().min(1).max(256),
    contentType: z.string().max(256).default("application/octet-stream"),
    base64: z.string(),
    enabled: z.boolean().default(true),
  }),
]);
const FormDataBody = z.object({
  type: z.literal("form-data"),
  fields: z.array(FormDataField).max(100),
});

const BinaryBody = z.object({
  type: z.literal("binary"),
  contentType: z.string().max(256).default("application/octet-stream"),
  base64: z.string(),
});

export const RequestBodySchema = z.discriminatedUnion("type", [
  NoBody,
  JsonBody,
  XmlBody,
  RawBody,
  UrlEncodedBody,
  FormDataBody,
  BinaryBody,
]);
export type RequestBody = z.infer<typeof RequestBodySchema>;

export const AuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("basic"), username: z.string().max(256), password: z.string().max(1024) }),
  z.object({ type: z.literal("bearer"), token: z.string().max(8192) }),
  z.object({
    type: z.literal("apiKey"),
    key: z.string().min(1).max(256),
    value: z.string().max(8192),
    in: z.enum(["header", "query"]).default("header"),
  }),
]);
export type Auth = z.infer<typeof AuthSchema>;

export const HttpRequestSchema = z.object({
  name: z.string().max(200).optional(),
  method: HttpMethodSchema,
  // Peut contenir des {{variables}} : l'URL n'est validée qu'après interpolation.
  url: z.string().min(1).max(2048),
  params: z.array(KeyValueSchema).max(100).default([]),
  headers: z.array(KeyValueSchema).max(100).default([]),
  body: RequestBodySchema.default({ type: "none" }),
  auth: AuthSchema.default({ type: "none" }),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  followRedirects: z.boolean().default(true),
});
export type HttpRequest = z.infer<typeof HttpRequestSchema>;

export const TimingsSchema = z.object({
  // null quand la valeur n'existe pas (ex. connexion réutilisée)
  dnsMs: z.number().nullable(),
  connectMs: z.number().nullable(),
  tlsMs: z.number().nullable(),
  ttfbMs: z.number().nullable(),
  transferMs: z.number().nullable(),
  totalMs: z.number(),
});
export type Timings = z.infer<typeof TimingsSchema>;

export const HttpResponseSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.array(z.object({ key: z.string(), value: z.string() })),
  body: z.object({
    encoding: z.enum(["utf8", "base64"]),
    content: z.string(),
    truncated: z.boolean(),
  }),
  sizeBytes: z.number().int().nonnegative(),
  timings: TimingsSchema,
  redirects: z.array(z.object({ url: z.string(), status: z.number().int() })),
  finalUrl: z.string(),
});
export type HttpResponse = z.infer<typeof HttpResponseSchema>;

export const ExecuteRequestInputSchema = z.object({
  request: HttpRequestSchema,
  variables: VariablesSchema.default({}),
});
export type ExecuteRequestInput = z.infer<typeof ExecuteRequestInputSchema>;