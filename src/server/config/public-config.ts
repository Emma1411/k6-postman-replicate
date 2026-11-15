import type { Env } from "./env.schema";
import type { Limits } from "./limits";

/** Configuration exposée au navigateur. Ne contient aucun détail d'infrastructure. */
export function buildPublicConfig(
  env: Pick<Env, "APP_VERSION" | "BOT_PROTECTION" | "TURNSTILE_SITE_KEY">,
  limits: Limits,
  workerReady: boolean,
) {
  return {
    version: env.APP_VERSION,
    deploymentMode: limits.deployment.mode,
    features: {
      loadTests: workerReady,
      privateNetworks: limits.network.allowPrivateNetworks,
      // Un booléen seulement : les noms d'hôtes restent côté serveur.
      prometheusPrivateHosts: limits.prometheus.allowedHosts.length > 0,
      botProtection:
        env.BOT_PROTECTION === "turnstile"
          ? {
              provider: "turnstile" as const,
              siteKey: env.TURNSTILE_SITE_KEY ?? null,
            }
          : null,
    },
    limits: {
      http: {
        maxTimeoutMs: limits.http.maxTimeoutMs,
        maxResponseBytes: limits.http.maxResponseBytes,
        maxRedirects: limits.http.maxRedirects,
        maxRequestBodyBytes: limits.http.maxRequestBodyBytes,
      },
      workflow: { maxSteps: limits.workflow.maxSteps },
      load: {
        maxVus: limits.load.maxVus,
        maxDurationSeconds: limits.load.maxDurationSeconds,
        maxRequestsPerSecond: limits.load.maxRequestsPerSecond,
        maxConcurrentRuns: limits.load.maxConcurrentRuns,
        runTtlSeconds: limits.load.runTtlSeconds,
      },
      rateLimit: {
        windowSeconds: limits.rateLimit.windowSeconds,
        maxRequests: limits.rateLimit.maxRequests,
        maxLoadRunsPerHour: limits.rateLimit.maxLoadRunsPerHour,
      },
    },
  };
}

export type PublicConfig = ReturnType<typeof buildPublicConfig>;
