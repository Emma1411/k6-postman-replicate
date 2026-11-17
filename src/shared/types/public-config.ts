/** Configuration publique d'une instance, telle que renvoyée par GET /api/config. */
export interface PublicConfig {
  version: string;
  deploymentMode: "public" | "private";
  status: { busy: boolean };
  features: {
    loadTests: boolean;
    privateNetworks: boolean;
    prometheusPrivateHosts: boolean;
    botProtection: { provider: "turnstile"; siteKey: string | null } | null;
  };
  limits: {
    http: {
      maxTimeoutMs: number;
      maxResponseBytes: number;
      maxRedirects: number;
      maxRequestBodyBytes: number;
    };
    workflow: { maxSteps: number };
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
    };
  };
}
