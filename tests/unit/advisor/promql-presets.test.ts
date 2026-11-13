import { describe, it, expect } from "vitest";
import { buildPromQlPresets } from "@/shared/advisor/promql-presets";

describe("buildPromQlPresets : node_exporter", () => {
  it("génère les requêtes avec les sélecteurs demandés", () => {
    const presets = buildPromQlPresets({
      compute: {
        source: "node_exporter",
        matchers: [{ label: "job", op: "=", value: "api" }],
        vcpuPerInstance: 2,
        ramGbPerInstance: 4,
      },
    });
    expect(presets.cpuPercent).toBe('100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle",job="api"}[1m])))');
    expect(presets.memoryPercent).toBe(
      '100 * (1 - sum(node_memory_MemAvailable_bytes{job="api"}) / sum(node_memory_MemTotal_bytes{job="api"}))',
    );
    expect(presets.memoryAvailableMb).toBe('avg(node_memory_MemAvailable_bytes{job="api"}) / 1048576');
    expect(presets.dbConnectionsUsed).toBeUndefined();
  });

  it("omet les accolades sans sélecteur et accepte une autre fenêtre", () => {
    const presets = buildPromQlPresets({
      compute: { source: "node_exporter", vcpuPerInstance: 2, ramGbPerInstance: 4 },
      rangeWindow: "2m",
    });
    expect(presets.cpuPercent).toBe('100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))');
    expect(presets.memoryAvailableMb).toBe("avg(node_memory_MemAvailable_bytes) / 1048576");
  });
});

describe("buildPromQlPresets : cAdvisor", () => {
  it("rapporte le CPU et la mémoire à la taille de l'instance", () => {
    const presets = buildPromQlPresets({
      compute: {
        source: "cadvisor",
        matchers: [{ label: "name", op: "=~", value: "api-.*" }],
        vcpuPerInstance: 2,
        ramGbPerInstance: 4,
      },
    });
    expect(presets.cpuPercent).toBe(
      '100 * avg(sum by (name) (rate(container_cpu_usage_seconds_total{name=~"api-.*"}[1m]))) / 2',
    );
    expect(presets.memoryPercent).toBe('100 * avg(container_memory_working_set_bytes{name=~"api-.*"}) / 4294967296');
    expect(presets.memoryAvailableMb).toBe(
      '(4294967296 - avg(container_memory_working_set_bytes{name=~"api-.*"})) / 1048576',
    );
  });

  it("utilise le label d'instance demandé (Kubernetes)", () => {
    const presets = buildPromQlPresets({
      compute: { source: "cadvisor", instanceLabel: "pod", vcpuPerInstance: 0.5, ramGbPerInstance: 1 },
    });
    expect(presets.cpuPercent).toBe("100 * avg(sum by (pod) (rate(container_cpu_usage_seconds_total[1m]))) / 0.5");
  });
});

describe("buildPromQlPresets : base de données", () => {
  it("génère les requêtes PostgreSQL et MySQL", () => {
    expect(buildPromQlPresets({ database: { source: "postgres_exporter", matchers: [{ label: "datname", op: "=", value: "app" }] } }).dbConnectionsUsed).toBe(
      'sum(pg_stat_database_numbackends{datname="app"})',
    );
    expect(buildPromQlPresets({ database: { source: "mysql_exporter" } }).dbConnectionsUsed).toBe(
      "sum(mysql_global_status_threads_connected)",
    );
  });
});

describe("buildPromQlPresets : sécurité des entrées", () => {
  const compute = { source: "node_exporter" as const, vcpuPerInstance: 2, ramGbPerInstance: 4 };

  it("échappe les valeurs de sélecteur", () => {
    const presets = buildPromQlPresets({
      compute: { ...compute, matchers: [{ label: "job", op: "=", value: 'a"} or vector(1) #\\' }] },
    });
    expect(presets.cpuPercent).toContain('job="a\\"} or vector(1) #\\\\"');
    // la valeur reste enfermée dans ses guillemets : une seule paire d'accolades dans le sélecteur
    expect(presets.cpuPercent?.match(/\{/g)).toHaveLength(1);
  });

  it("refuse les noms de labels, opérateurs et fenêtres invalides", () => {
    expect(() => buildPromQlPresets({ compute: { ...compute, matchers: [{ label: "job}", op: "=", value: "x" }] } })).toThrow(/label invalide/);
    expect(() => buildPromQlPresets({ compute: { ...compute, matchers: [{ label: "job", op: "==" as never, value: "x" }] } })).toThrow(/Opérateur/);
    expect(() => buildPromQlPresets({ compute, rangeWindow: "1m]) or (" })).toThrow(/Fenêtre/);
    expect(() => buildPromQlPresets({ compute: { source: "cadvisor", instanceLabel: "a b", vcpuPerInstance: 1, ramGbPerInstance: 1 } })).toThrow(/label invalide/);
    expect(() => buildPromQlPresets({ compute: { source: "cadvisor", vcpuPerInstance: 0, ramGbPerInstance: 1 } })).toThrow(/positifs/);
  });
});