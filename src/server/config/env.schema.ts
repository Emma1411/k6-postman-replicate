
import { z } from "zod";

const emptyToUndefined = (v: unknown) =>
  v === "" ? undefined : v;

const int = (
  def: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
) =>
  z.coerce.number().int().min(min).max(max).default(def);

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    ALLOW_PRIVATE_NETWORKS: bool,
    DEPLOYMENT_MODE: z.enum(["public", "private"]).default("public"),
    APP_VERSION: z.string().max(64).default("dev"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    HTTP_MAX_TIMEOUT_MS: int(30_000, 100, 120_000),
    HTTP_MAX_RESPONSE_BYTES: int(5 * 1024 * 1024, 1024),
    HTTP_MAX_REDIRECTS: int(5, 0, 20),
    HTTP_MAX_REQUEST_BODY_BYTES: int(5 * 1024 * 1024, 1024),

    WORKFLOW_MAX_STEPS: int(50, 1, 200),
    WORKFLOW_MAX_DURATION_SECONDS: int(120, 1, 3600),

    LOAD_MAX_VUS: int(100, 1, 100_000),
    LOAD_MAX_DURATION_SECONDS: int(120, 1, 86_400),
    LOAD_MAX_RPS: int(500, 1, 1_000_000),
    LOAD_MAX_CONCURRENT_RUNS: int(1, 1, 100),
    LOAD_RUN_TTL_SECONDS: int(900, 60, 86_400),

    LOAD_MAX_WORKERS: int(4, 1, 64),
    LOAD_WORKER_PATH: z
      .string()
      .min(1)
      .default("dist/workers/load-worker.js"),
    LOAD_GRACEFUL_STOP_SECONDS: int(10, 0, 120),
    LOAD_DETACH_GRACE_SECONDS: int(30, 1, 600),

    PROMETHEUS_ALLOWED_HOSTS: z.string().default(""),
    PROMETHEUS_TIMEOUT_MS: int(15_000, 1000, 120_000),

    RATE_LIMIT_WINDOW_SECONDS: int(60, 1, 3600),
    RATE_LIMIT_MAX_REQUESTS: int(120, 1, 100_000),
    RATE_LIMIT_LOAD_RUNS_PER_HOUR: int(10, 1, 10_000),
    TRUSTED_PROXY_HOPS: int(1, 0, 5),

    // Protection contre les robots
    BOT_PROTECTION: z
      .enum(["off", "turnstile"])
      .default("off"),

    TURNSTILE_SITE_KEY: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    TURNSTILE_SECRET_KEY: z.preprocess(
      emptyToUndefined,
      z.string().min(1).optional(),
    ),

    BOT_TOKEN_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().min(32).optional(),
    ),

    BOT_PASS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(3600),

    BOT_BIND_IP: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform((s) =>
        s.split(",").map((x) => x.trim()).filter(Boolean),
      ),
  })
  .superRefine((v, ctx) => {
    if (
      v.NODE_ENV === "production" &&
      v.DEPLOYMENT_MODE === "public" &&
      v.ALLOW_PRIVATE_NETWORKS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_PRIVATE_NETWORKS"],
        message:
          "ALLOW_PRIVATE_NETWORKS=true est interdit en production en mode public. " +
          "N'utilise DEPLOYMENT_MODE=private que si l'instance n'est accessible qu'à des personnes de confiance.",
      });
    }

    const hostEntry =
      /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9._-]+)(:\d{1,5})?$/;

    for (const entry of v.PROMETHEUS_ALLOWED_HOSTS
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!hostEntry.test(entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["PROMETHEUS_ALLOWED_HOSTS"],
          message: `Entrée invalide : « ${entry} » (attendu : hôte ou hôte:port).`,
        });
      }
    }

    // Configuration obligatoire lorsque Turnstile est activé.
    if (v.BOT_PROTECTION === "turnstile") {
      for (const key of [
        "TURNSTILE_SITE_KEY",
        "TURNSTILE_SECRET_KEY",
        "BOT_TOKEN_SECRET",
      ] as const) {
        if (!v[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} est requis quand BOT_PROTECTION=turnstile.`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(
  source: Record<string, string | undefined>,
): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(racine)"}: ${i.message}`,
    );

    throw new Error(
      `Configuration invalide :\n${lines.join("\n")}`,
    );
  }

  return result.data;
}
