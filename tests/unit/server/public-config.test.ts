import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { buildPublicConfig } from "@/server/config/public-config";

describe("buildPublicConfig", () => {
  const env = parseEnv({
    APP_VERSION: "1.2.3",
    PROMETHEUS_ALLOWED_HOSTS: "prometheus.corp.internal:9090",
    LOAD_WORKER_PATH: "secret/place/worker.js",
    TRUSTED_PROXY_HOPS: "2",
  });
  const config = buildPublicConfig(env, buildLimits(env), true);

  it("expose la version, le mode et les limites utiles au client", () => {
    expect(config.version).toBe("1.2.3");
    expect(config.deploymentMode).toBe("public");
    expect(config.limits.load.maxVus).toBe(100);
    expect(config.limits.load.maxDurationSeconds).toBe(120);
    expect(config.limits.workflow.maxSteps).toBe(50);
    expect(config.features.loadTests).toBe(true);
  });

  it("n'expose que le fait qu'un hôte Prometheus privé est autorisé", () => {
    expect(config.features.prometheusPrivateHosts).toBe(true);
    const json = JSON.stringify(config);
    expect(json).not.toContain("corp.internal");
    expect(json).not.toContain("secret/place");
    expect(json).not.toContain("trustedProxy");
  });

  it("signale l'absence du worker", () => {
    const env2 = parseEnv({});
    expect(buildPublicConfig(env2, buildLimits(env2), false).features.loadTests).toBe(false);
  });
});

  it("expose la clé de site mais jamais le secret", () => {
    const e = parseEnv({
      BOT_PROTECTION: "turnstile",
      TURNSTILE_SITE_KEY: "site-publique",
      TURNSTILE_SECRET_KEY: "secret-prive",
      BOT_TOKEN_SECRET: "x".repeat(40),
    });
    const cfg = buildPublicConfig(e, buildLimits(e), true);
    expect(cfg.features.botProtection).toEqual({ provider: "turnstile", siteKey: "site-publique" });
    expect(JSON.stringify(cfg)).not.toContain("secret-prive");
    expect(JSON.stringify(cfg)).not.toContain("xxxxxxxx");
  });