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

describe("DEPLOYMENT_MODE", () => {
  it("est public par défaut", () => {
    expect(parseEnv({}).DEPLOYMENT_MODE).toBe("public");
  });

  it("refuse les réseaux privés en production en mode public", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", ALLOW_PRIVATE_NETWORKS: "true" }),
    ).toThrow(/mode public/);
  });

  it("autorise les réseaux privés en production en mode private", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DEPLOYMENT_MODE: "private",
      ALLOW_PRIVATE_NETWORKS: "true",
    });
    expect(env.ALLOW_PRIVATE_NETWORKS).toBe(true);
  });

  it("rejette un mode inconnu", () => {
    expect(() => parseEnv({ DEPLOYMENT_MODE: "internal" })).toThrow();
  });
});

describe("protection anti-robot", () => {
  it("exige les clés quand BOT_PROTECTION=turnstile", () => {
    expect(() => parseEnv({ BOT_PROTECTION: "turnstile" })).toThrow(/TURNSTILE_SITE_KEY/);
  });

  it("refuse un secret de jeton trop court", () => {
    expect(() =>
      parseEnv({
        BOT_PROTECTION: "turnstile",
        TURNSTILE_SITE_KEY: "site",
        TURNSTILE_SECRET_KEY: "secret",
        BOT_TOKEN_SECRET: "court",
      }),
    ).toThrow();
  });

  it("traite les chaînes vides (docker compose) comme non définies", () => {
    const env = parseEnv({ TURNSTILE_SECRET_KEY: "", BOT_TOKEN_SECRET: "", ALLOWED_ORIGINS: "" });
    expect(env.BOT_PROTECTION).toBe("off");
    expect(env.ALLOWED_ORIGINS).toEqual([]);
  });
});