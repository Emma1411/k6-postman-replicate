import { z } from "zod";

const int = (def: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ALLOW_PRIVATE_NETWORKS: bool,

    HTTP_MAX_TIMEOUT_MS: int(30_000, 100, 120_000),
    HTTP_MAX_RESPONSE_BYTES: int(5 * 1024 * 1024, 1024),
    HTTP_MAX_REDIRECTS: int(5, 0, 20),
    HTTP_MAX_REQUEST_BODY_BYTES: int(5 * 1024 * 1024, 1024),

    WORKFLOW_MAX_STEPS: int(50, 1, 200),

    LOAD_MAX_VUS: int(100, 1, 100_000),
    LOAD_MAX_DURATION_SECONDS: int(120, 1, 86_400),
    LOAD_MAX_RPS: int(500, 1, 1_000_000),
    LOAD_MAX_CONCURRENT_RUNS: int(1, 1, 100),
    LOAD_RUN_TTL_SECONDS: int(900, 60, 86_400),

    RATE_LIMIT_WINDOW_SECONDS: int(60, 1, 3600),
    RATE_LIMIT_MAX_REQUESTS: int(120, 1, 100_000),
    RATE_LIMIT_LOAD_RUNS_PER_HOUR: int(10, 1, 10_000),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === "production" && v.ALLOW_PRIVATE_NETWORKS) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_PRIVATE_NETWORKS"],
        message: "ALLOW_PRIVATE_NETWORKS=true est interdit en production.",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(racine)"}: ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join("\n")}`);
  }
  return result.data;
}