import { describe, it, expect } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { isAllowlisted } from "@/server/services/prometheus/client";

describe("configuration Prometheus", () => {
  it("lit la liste d'hôtes de confiance et le délai", () => {
    const limits = buildLimits(parseEnv({ PROMETHEUS_ALLOWED_HOSTS: " Prometheus.internal:9090 , localhost,[::1] ", PROMETHEUS_TIMEOUT_MS: "5000" }));
    expect(limits.prometheus.allowedHosts).toEqual(["prometheus.internal:9090", "localhost", "[::1]"]);
    expect(limits.prometheus.timeoutMs).toBe(5000);
  });

  it("est vide par défaut", () => {
    expect(buildLimits(parseEnv({})).prometheus).toEqual({ allowedHosts: [], timeoutMs: 15_000 });
  });

  it("refuse une entrée invalide", () => {
    expect(() => parseEnv({ PROMETHEUS_ALLOWED_HOSTS: "bon.host,mauvais host" })).toThrow(/PROMETHEUS_ALLOWED_HOSTS/);
    expect(() => parseEnv({ PROMETHEUS_ALLOWED_HOSTS: "http://prom" })).toThrow(/PROMETHEUS_ALLOWED_HOSTS/);
  });
});

describe("isAllowlisted", () => {
  it("autorise un hôte sur tous les ports, ou sur un port précis", () => {
    expect(isAllowlisted(new URL("http://prom.internal:9090/x"), ["prom.internal"])).toBe(true);
    expect(isAllowlisted(new URL("http://prom.internal:9090/x"), ["prom.internal:9090"])).toBe(true);
    expect(isAllowlisted(new URL("http://prom.internal:9091/x"), ["prom.internal:9090"])).toBe(false);
  });

  it("utilise le port par défaut du protocole", () => {
    expect(isAllowlisted(new URL("https://prom.internal/x"), ["prom.internal:443"])).toBe(true);
    expect(isAllowlisted(new URL("http://prom.internal/x"), ["prom.internal:443"])).toBe(false);
    expect(isAllowlisted(new URL("http://prom.internal/x"), ["prom.internal:80"])).toBe(true);
  });

  it("gère l'IPv6 et la casse", () => {
    expect(isAllowlisted(new URL("http://[::1]:9090/"), ["[::1]"])).toBe(true);
    expect(isAllowlisted(new URL("http://[::1]:9090/"), ["[::1]:9090"])).toBe(true);
    expect(isAllowlisted(new URL("http://PROM.internal/"), ["prom.internal"])).toBe(true);
  });

  it("refuse tout hôte absent de la liste", () => {
    expect(isAllowlisted(new URL("http://autre.internal/"), ["prom.internal"])).toBe(false);
    expect(isAllowlisted(new URL("http://prom.internal.evil.com/"), ["prom.internal"])).toBe(false);
    expect(isAllowlisted(new URL("http://prom.internal/"), [])).toBe(false);
  });
});