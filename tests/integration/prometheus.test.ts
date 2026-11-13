import { afterEach, describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { checkConnection } from "@/server/services/prometheus/client";
import { queryInfrastructure } from "@/server/services/prometheus/infrastructure";
import { analyzeRun } from "@/shared/advisor/analyze";
import {
  MeasuredRunSchema,
  PrometheusQueryInputSchema,
  normalizeAnalyzeInput,
} from "@/shared/schemas";
import { latencyKnee, makeRun, ramp } from "../helpers/advisor-fixtures";
import {
  matrixOf,
  promError,
  series,
  startFakePrometheus,
  type FakePrometheus,
  type FakeResponse,
  type RecordedRequest,
} from "../target-server/prometheus";

const STARTED = 1_700_000_000_000;
const START = STARTED / 1000;

let fake: FakePrometheus | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

async function start(handler: (req: RecordedRequest) => FakeResponse) {
  fake = await startFakePrometheus(handler);
  return fake;
}

const trusted = (prom: FakePrometheus) =>
  buildLimits(parseEnv({ PROMETHEUS_ALLOWED_HOSTS: `127.0.0.1:${prom.port}` }));

function input(prom: FakePrometheus, extra: Record<string, unknown> = {}) {
  return PrometheusQueryInputSchema.parse({
    baseUrl: prom.url,
    startedAtMs: STARTED,
    durationSeconds: 60,
    stepSeconds: 5,
    queries: { cpuPercent: "cpu", memoryPercent: "mem" },
    ...extra,
  });
}

/** Réponses par défaut : le CPU monte de 10 à 95 %, la mémoire de 40 à 52 %. */
const standard = (req: RecordedRequest): FakeResponse => {
  const start = Number(req.params.get("start"));
  const query = req.params.get("query");
  if (query === "cpu")
    return {
      body: matrixOf([
        series(start, 5, [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 95, 95, 95]),
      ]),
    };
  if (query === "mem")
    return {
      body: matrixOf([
        series(start, 5, [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52]),
      ]),
    };
  return { status: 400, body: promError("requête inconnue") };
};

describe("queryInfrastructure", () => {
  it("renvoie des échantillons alignés sur le test, avec la provenance « observed »", async () => {
    const prom = await start(standard);
    const result = await queryInfrastructure(input(prom), {
      limits: trusted(prom),
    });

    expect(result.infraMetrics.provenance).toBe("observed");
    expect(result.infraMetrics.samples).toHaveLength(13);
    expect(result.infraMetrics.samples[0]).toEqual({
      t: 0,
      cpuPercent: 10,
      memoryPercent: 40,
    });
    expect(result.infraMetrics.samples[12]).toEqual({
      t: 60,
      cpuPercent: 95,
      memoryPercent: 52,
    });
    expect(result.metrics.map((m) => `${m.key}:${m.status}`)).toEqual([
      "cpuPercent:ok",
      "memoryPercent:ok",
    ]);
    expect(result.missing).toEqual([
      "memoryAvailableMb",
      "dbConnectionsUsed",
      "networkRttMs",
    ]);
    expect(result.range).toEqual({
      startedAtMs: STARTED,
      durationSeconds: 60,
      stepSeconds: 5,
      samples: 13,
    });

    const call = prom.requests.find((r) => r.params.get("query") === "cpu");
    expect(call?.path).toBe("/api/v1/query_range");
    expect(call?.params.get("start")).toBe(String(START));
    expect(call?.params.get("end")).toBe(String(START + 60));
    expect(call?.params.get("step")).toBe("5");
  });

  it("tient compte du décalage d'horloge de Prometheus", async () => {
    const prom = await start(standard);
    const result = await queryInfrastructure(
      input(prom, { clockOffsetSeconds: 3600 }),
      { limits: trusted(prom) },
    );

    const call = prom.requests.find((r) => r.params.get("query") === "cpu");
    expect(call?.params.get("start")).toBe(String(START + 3600));
    expect(result.infraMetrics.samples[0].t).toBe(0);
    expect(result.infraMetrics.samples[12].t).toBe(60);
  });

  it("moyenne les séries multiples en le signalant", async () => {
    const prom = await start((req) => {
      const start = Number(req.params.get("start"));
      return {
        body: matrixOf([
          series(start, 5, [10, 20]),
          series(start, 5, [30, 40]),
        ]),
      };
    });
    const result = await queryInfrastructure(
      input(prom, { queries: { cpuPercent: "cpu" }, durationSeconds: 5 }),
      {
        limits: trusted(prom),
      },
    );
    expect(result.infraMetrics.samples.map((s) => s.cpuPercent)).toEqual([
      20, 30,
    ]);
    expect(result.warnings.join(" ")).toContain("2 séries");
    expect(result.metrics[0].seriesCount).toBe(2);
  });

  it("ignore les valeurs non numériques et ramène les valeurs hors bornes", async () => {
    const prom = await start((req) => {
      const start = Number(req.params.get("start"));
      return { body: matrixOf([series(start, 5, ["NaN", 130, 50])]) };
    });
    const result = await queryInfrastructure(
      input(prom, { queries: { cpuPercent: "cpu" }, durationSeconds: 10 }),
      {
        limits: trusted(prom),
      },
    );
    expect(result.infraMetrics.samples.map((s) => s.cpuPercent)).toEqual([
      100, 50,
    ]);
    expect(result.warnings.join(" ")).toContain("non numériques");
    expect(result.warnings.join(" ")).toContain("hors bornes");
  });

  it("garde les métriques disponibles quand une autre échoue", async () => {
    const prom = await start((req) =>
      req.params.get("query") === "mem"
        ? { status: 400, body: promError("parse error: unexpected end") }
        : standard(req),
    );
    const result = await queryInfrastructure(input(prom), {
      limits: trusted(prom),
    });

    expect(
      result.infraMetrics.samples.every(
        (s) => s.cpuPercent !== undefined && s.memoryPercent === undefined,
      ),
    ).toBe(true);
    const mem = result.metrics.find((m) => m.key === "memoryPercent");
    expect(mem?.status).toBe("error");
    expect(mem?.message).toContain("parse error");
    expect(result.missing).toContain("memoryPercent");
  });

  it("signale une métrique sans données sans bloquer les autres", async () => {
    const prom = await start((req) =>
      req.params.get("query") === "mem"
        ? { body: matrixOf([]) }
        : standard(req),
    );
    const result = await queryInfrastructure(input(prom), {
      limits: trusted(prom),
    });
    const mem = result.metrics.find((m) => m.key === "memoryPercent");
    expect(mem?.status).toBe("no-data");
    expect(mem?.message).toContain("décalage d'horloge");
    expect(result.missing).toContain("memoryPercent");
  });

  it("échoue clairement quand aucune métrique ne répond", async () => {
    const allBad = await start(() => ({
      status: 400,
      body: promError("bad query"),
    }));
    await expect(
      queryInfrastructure(input(allBad), { limits: trusted(allBad) }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await allBad.close();

    const empty = await start(() => ({ body: matrixOf([]) }));
    fake = empty;
    await expect(
      queryInfrastructure(input(empty), { limits: trusted(empty) }),
    ).rejects.toThrow(/aucune donnée/);
  });

  it("refuse une demande de trop de points sans appeler Prometheus", async () => {
    const prom = await start(standard);
    await expect(
      queryInfrastructure(
        input(prom, { durationSeconds: 86_400, stepSeconds: 1 }),
        { limits: trusted(prom) },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prom.requests).toHaveLength(0);
  });

  it("gère un préfixe d'URL (Prometheus derrière un chemin)", async () => {
    const prom = await start(standard);
    await queryInfrastructure(
      input(prom, { baseUrl: `${prom.url}/prometheus/` }),
      { limits: trusted(prom) },
    );
    expect(prom.requests[0].path).toBe("/prometheus/api/v1/query_range");
  });

  it("envoie les identifiants demandés", async () => {
    const prom = await start(standard);
    await queryInfrastructure(
      input(prom, {
        auth: { type: "basic", username: "user", password: "pass" },
      }),
      {
        limits: trusted(prom),
      },
    );
    expect(prom.requests[0].headers.authorization).toBe("Basic dXNlcjpwYXNz");

    const bearerProm = await start(standard);
    await queryInfrastructure(
      input(bearerProm, { auth: { type: "bearer", token: "abc.def" } }),
      {
        limits: trusted(bearerProm),
      },
    );
    expect(bearerProm.requests[0].headers.authorization).toBe("Bearer abc.def");
    await bearerProm.close();
  });
});

describe("erreurs HTTP", () => {
  const run = async (response: FakeResponse) => {
    const prom = await start(() => response);
    return queryInfrastructure(
      input(prom, { queries: { cpuPercent: "cpu" } }),
      { limits: trusted(prom) },
    );
  };

  it("distingue une authentification refusée d'une panne", async () => {
    await expect(run({ status: 401, body: {} })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      message: expect.stringContaining("Authentification"),
    });
    await expect(
      run({ status: 503, body: { status: "error", error: "overloaded" } }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      message: expect.stringContaining("overloaded"),
    });
  });

  it("ne suit pas les redirections", async () => {
    await expect(
      run({ status: 302, headers: { location: "http://169.254.169.254/" } }),
    ).rejects.toThrow(/redirection/);
  });

  it("refuse une réponse qui n'est pas du JSON Prometheus", async () => {
    await expect(run({ body: "pas du json" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
    await expect(
      run({
        body: { status: "success", data: { resultType: "vector", result: [] } },
      }),
    ).rejects.toThrow(/matrice/);
  });
});

describe("garde SSRF", () => {
  it("refuse un hôte privé absent de la liste de confiance", async () => {
    const prom = await start(standard);
    await expect(
      queryInfrastructure(input(prom), { limits: buildLimits(parseEnv({})) }),
    ).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
    expect(prom.requests).toHaveLength(0);
  });

  it("refuse un hôte de confiance sur un autre port", async () => {
    const prom = await start(standard);
    const limits = buildLimits(
      parseEnv({ PROMETHEUS_ALLOWED_HOSTS: "127.0.0.1:1" }),
    );
    await expect(
      queryInfrastructure(input(prom), { limits }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("accepte un hôte de confiance sans port, et le mode développement", async () => {
    const prom = await start(standard);
    const byHost = buildLimits(
      parseEnv({ PROMETHEUS_ALLOWED_HOSTS: "127.0.0.1" }),
    );
    await expect(
      queryInfrastructure(input(prom), { limits: byHost }),
    ).resolves.toBeDefined();

    const dev = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" }));
    await expect(
      queryInfrastructure(input(prom), { limits: dev }),
    ).resolves.toBeDefined();
  });

  it("refuse une adresse sans schéma ou avec des identifiants", async () => {
    const limits = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" }));
    const base = {
      startedAtMs: STARTED,
      durationSeconds: 10,
      queries: { cpuPercent: "cpu" },
    };
    await expect(
      queryInfrastructure(
        PrometheusQueryInputSchema.parse({
          ...base,
          baseUrl: "localhost:9090",
        }),
        { limits },
      ),
    ).rejects.toThrow(/http:\/\//);
    await expect(
      queryInfrastructure(
        PrometheusQueryInputSchema.parse({
          ...base,
          baseUrl: "http://user:pass@localhost:9090",
        }),
        { limits },
      ),
    ).rejects.toThrow(/identifiants/);
  });
});

describe("checkConnection", () => {
  it("valide l'accès avec une requête triviale", async () => {
    const prom = await start(() => ({
      body: { status: "success", data: { resultType: "vector", result: [] } },
    }));
    const result = await checkConnection(
      { baseUrl: prom.url },
      { limits: trusted(prom) },
    );
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(prom.requests[0].path).toBe("/api/v1/query");
    expect(prom.requests[0].params.get("query")).toBe("vector(1)");
  });

  it("signale une authentification refusée", async () => {
    const prom = await start(() => ({ status: 401, body: {} }));
    await expect(
      checkConnection({ baseUrl: prom.url }, { limits: trusted(prom) }),
    ).rejects.toThrow(/Authentification/);
  });
});

describe("de Prometheus à l'Advisor", () => {
  it("des métriques observées donnent un diagnostic CPU de provenance « observed »", async () => {
    // test de charge synthétique : rampe de 14 à 490 req/s, latence qui s'envole à partir de 70 s
    const loadRun = makeRun({ seconds: 120, rps: ramp, p95: latencyKnee(70) });
    const cpuSeries = Array.from({ length: 25 }, (_, i) =>
      Math.min(100, ramp(i * 5) / 4.5),
    );
    const prom = await start((req) => ({
      body: matrixOf([series(Number(req.params.get("start")), 5, cpuSeries)]),
    }));

    const result = await queryInfrastructure(
      input(prom, { durationSeconds: 120, queries: { cpuPercent: "cpu" } }),
      { limits: trusted(prom) },
    );
    const run = MeasuredRunSchema.parse({
      ...loadRun,
      infraMetrics: result.infraMetrics,
    });

    const analysis = analyzeRun(
      normalizeAnalyzeInput({
        run,
        objectives: {
          targetRps: 400,
          p95MaxMs: 200,
        },
        policy: {
          sustainSeconds: 20,
        },
      } as Parameters<typeof normalizeAnalyzeInput>[0]),
    );
  });
});
