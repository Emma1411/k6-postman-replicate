import "server-only";
import type { Env } from "./env.schema";

export interface Limits {
  network: { allowPrivateNetworks: boolean };
  http: {
    maxTimeoutMs: number;
    maxResponseBytes: number;
    maxRedirects: number;
    maxRequestBodyBytes: number;
  };
  workflow: { maxSteps: number; maxDurationSeconds: number };
  load: {
    maxVus: number;
    maxDurationSeconds: number;
    maxRequestsPerSecond: number;
    maxConcurrentRuns: number;
    runTtlSeconds: number;
  };
  rateLimit: {
    windowSeconds: number;
    maxRequests: number;
    maxLoadRunsPerHour: number;
    trustedProxyHops: number;
  };
}

export function buildLimits(e: Env): Limits {
  return {
    network: { allowPrivateNetworks: e.ALLOW_PRIVATE_NETWORKS },
    http: {
      maxTimeoutMs: e.HTTP_MAX_TIMEOUT_MS,
      maxResponseBytes: e.HTTP_MAX_RESPONSE_BYTES,
      maxRedirects: e.HTTP_MAX_REDIRECTS,
      maxRequestBodyBytes: e.HTTP_MAX_REQUEST_BODY_BYTES,
    },
    workflow: {
      maxSteps: e.WORKFLOW_MAX_STEPS,
      maxDurationSeconds: e.WORKFLOW_MAX_DURATION_SECONDS,
    },
    load: {
      maxVus: e.LOAD_MAX_VUS,
      maxDurationSeconds: e.LOAD_MAX_DURATION_SECONDS,
      maxRequestsPerSecond: e.LOAD_MAX_RPS,
      maxConcurrentRuns: e.LOAD_MAX_CONCURRENT_RUNS,
      runTtlSeconds: e.LOAD_RUN_TTL_SECONDS,
    },
    rateLimit: {
      windowSeconds: e.RATE_LIMIT_WINDOW_SECONDS,
      maxRequests: e.RATE_LIMIT_MAX_REQUESTS,
      maxLoadRunsPerHour: e.RATE_LIMIT_LOAD_RUNS_PER_HOUR,
      trustedProxyHops: e.TRUSTED_PROXY_HOPS,
    },
  };
}
