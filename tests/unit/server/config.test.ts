import { describe, it, expect } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";

describe("parseEnv", () => {
  it("applique les valeurs par défaut", () => {
    const env = parseEnv({});
    expect(env.LOAD_MAX_VUS).toBe(100);
    expect(env.ALLOW_PRIVATE_NETWORKS).toBe(false);
  });

  it("lit les valeurs fournies", () => {
    const env = parseEnv({ LOAD_MAX_VUS: "25", ALLOW_PRIVATE_NETWORKS: "true" });
    expect(env.LOAD_MAX_VUS).toBe(25);
    expect(env.ALLOW_PRIVATE_NETWORKS).toBe(true);
  });

  it("refuse ALLOW_PRIVATE_NETWORKS=true en production", () => {
    expect(() => parseEnv({ NODE_ENV: "production", ALLOW_PRIVATE_NETWORKS: "true" })).toThrow(
      /ALLOW_PRIVATE_NETWORKS/,
    );
  });

  it("refuse une valeur numérique invalide", () => {
    expect(() => parseEnv({ LOAD_MAX_VUS: "abc" })).toThrow(/LOAD_MAX_VUS/);
  });
});

describe("buildLimits", () => {
  it("regroupe les variables d'environnement par domaine", () => {
    const limits = buildLimits(parseEnv({ LOAD_MAX_RPS: "200", HTTP_MAX_REDIRECTS: "3" }));
    expect(limits.load.maxRequestsPerSecond).toBe(200);
    expect(limits.http.maxRedirects).toBe(3);
    expect(limits.network.allowPrivateNetworks).toBe(false);
  });
});