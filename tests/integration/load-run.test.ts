import { EventEmitter } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { LoadRun, type LoadRunDeps, type WorkerLike } from "@/server/engine/runs/load-run";
import { RunRegistry } from "@/server/engine/runs/run-registry";
import { LoadScenarioSchema } from "@/shared/schemas";
import type { LoadEvent } from "@/shared/types/load-result";
import { InProcessWorker } from "../helpers/in-process-worker";
import { startTargetServer, type TargetServer } from "../target-server/server";

const limits = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" }));

let server: TargetServer;
beforeAll(async () => {
  server = await startTargetServer();
});
afterAll(async () => {
  await server.close();
});

function scenario(executor: unknown, thresholds: unknown[] = [], path = "/echo") {
  return LoadScenarioSchema.parse({
    name: "test de charge",
    workflow: {
      name: "w",
      variables: { base: server.url },
      steps: [
        {
          id: "s1",
          name: "requête",
          request: { method: "GET", url: `{{base}}${path}` },
          assertions: [{ type: "status", expected: 200 }],
        },
      ],
    },
    executor,
    thresholds,
  });
}

const deps = (over: Partial<LoadRunDeps> = {}): LoadRunDeps => ({
  limits,
  createWorker: () => new InProcessWorker() as unknown as WorkerLike,
  maxWorkers: 2,
  detachGraceMs: 60_000,
  gracefulStopMs: 2000,
  ...over,
});

function makeRun(s: ReturnType<typeof scenario>, over: Partial<LoadRunDeps> = {}, subscribe = true) {
  const run = new LoadRun(s, deps(over));
  const events: LoadEvent[] = [];
  if (subscribe) run.subscribe((e) => events.push(e));
  return { run, events };
}

describe("LoadRun", () => {
  it("exécute un test avec plusieurs workers et fusionne leurs métriques", async () => {
    const { run, events } = makeRun(
      scenario({ type: "constant-vus", vus: 4, durationSeconds: 3 }, [
        { metric: "http_req_duration", expression: "p(95)<2000" },
        { metric: "http_req_failed", expression: "rate<0.01" },
        { metric: "checks", expression: "rate>0.99" },
      ]),
    );
    run.start();
    const result = await run.finished;

    expect(result.status).toBe("passed");
    expect(result.thresholdsPassed).toBe(true);
    expect(result.snapshot.http_reqs.count).toBeGreaterThan(50);
    expect(result.snapshot.http_req_failed.rate).toBe(0);
    expect(result.snapshot.statusDistribution["200"]).toBe(result.snapshot.http_reqs.count);
    expect(result.snapshot.vus.max).toBe(4);
    expect(result.snapshot.checks.rate).toBe(1);
    expect(result.generator.workers).toBe(2);
    expect(result.durationSeconds).toBeGreaterThan(2);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("started");
    expect(types.at(-1)).toBe("finished");
    expect(types.filter((t) => t === "window").length).toBeGreaterThanOrEqual(2);
    expect(run.isFinished).toBe(true);
  });

  it("répartit une cadence imposée entre les workers", async () => {
    const { run } = makeRun(
      scenario({ type: "constant-arrival-rate", rate: 50, durationSeconds: 2, preAllocatedVus: 4, maxVus: 20 }),
    );
    run.start();
    const result = await run.finished;
    expect(result.snapshot.iterations.count).toBeGreaterThanOrEqual(95);
    expect(result.snapshot.iterations.count).toBeLessThanOrEqual(100);
    expect(result.snapshot.dropped_iterations.count).toBe(0);
  });

  it("signale un threshold non respecté", async () => {
    const { run } = makeRun(
      scenario(
        { type: "constant-vus", vus: 2, durationSeconds: 2 },
        [{ metric: "http_req_failed", expression: "rate<0.01" }],
        "/status/500",
      ),
    );
    run.start();
    const result = await run.finished;
    expect(result.status).toBe("failed");
    expect(result.thresholdsPassed).toBe(false);
    expect(result.thresholds[0]).toMatchObject({ metric: "http_req_failed", passed: false, value: 1 });
    expect(result.snapshot.statusDistribution["500"]).toBe(result.snapshot.http_reqs.count);
  });

  it("arrête le test dès qu'un threshold abortOnFail est violé", async () => {
    const { run } = makeRun(
      scenario(
        { type: "constant-vus", vus: 2, durationSeconds: 30 },
        [{ metric: "http_req_failed", expression: "rate<0.01", abortOnFail: true }],
        "/status/500",
      ),
    );
    const started = Date.now();
    run.start();
    const result = await run.finished;

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe("failed");
    expect(result.abortReason).toContain("http_req_failed");
  });

  it("s'annule à la demande", async () => {
    const { run, events } = makeRun(scenario({ type: "constant-vus", vus: 3, durationSeconds: 30 }));
    const started = Date.now();
    run.start();
    setTimeout(() => run.cancel("test", "cancelled"), 1500);
    const result = await run.finished;

    expect(Date.now() - started).toBeLessThan(8000);
    expect(result.status).toBe("aborted");
    expect(result.abortReason).toBe("test");
    expect(events.some((e) => e.type === "stopping")).toBe(true);
    expect(result.snapshot.http_req_failed.fails).toBe(0); // les requêtes interrompues ne sont pas des échecs
  });

  it("s'annule quand plus aucun client n'est connecté", async () => {
    const { run } = makeRun(scenario({ type: "constant-vus", vus: 2, durationSeconds: 30 }), { detachGraceMs: 800 }, false);
    run.start();
    const result = await run.finished;
    expect(result.status).toBe("aborted");
    expect(result.abortReason).toContain("client");
  });

  it("ne s'annule pas tant qu'un client est connecté, et permet de se reconnecter", async () => {
    const { run } = makeRun(scenario({ type: "constant-vus", vus: 2, durationSeconds: 2 }), { detachGraceMs: 500 }, false);
    const unsubscribe = run.subscribe(() => undefined);
    run.start();
    await new Promise((r) => setTimeout(r, 1200));
    unsubscribe();
    run.subscribe(() => undefined); // reconnexion avant la fin du délai
    const result = await run.finished;
    expect(result.status).toBe("passed");
  });

  it("décrit l'état courant pour un client qui se rattache", async () => {
    const { run } = makeRun(scenario({ type: "constant-vus", vus: 2, durationSeconds: 3 }));
    expect(run.initEvent()).toMatchObject({ type: "init", result: null, snapshot: null });

    run.start();
    await new Promise((r) => setTimeout(r, 1800));
    const mid = run.initEvent();
    expect(mid.type === "init" && mid.points.length).toBeGreaterThanOrEqual(1);
    expect(mid.type === "init" && mid.snapshot).not.toBeNull();
    expect(mid.type === "init" && mid.run.state).toBe("running");

    const result = await run.finished;
    const end = run.initEvent();
    expect(end.type === "init" && end.result).toEqual(result);
    expect(end.type === "init" && end.run.state).toBe("finished");
  });

  it("termine en erreur quand un worker plante", async () => {
    class BrokenWorker extends EventEmitter {
      constructor() {
        super();
        setImmediate(() => this.emit("message", { type: "ready" }));
      }
      postMessage(message: { type: string }): void {
        if (message.type === "start") setImmediate(() => this.emit("error", new Error("boom")));
      }
      async terminate(): Promise<number> {
        return 0;
      }
    }
    const { run } = makeRun(scenario({ type: "constant-vus", vus: 1, durationSeconds: 5 }), {
      createWorker: () => new BrokenWorker() as unknown as WorkerLike,
    });
    run.start();
    const result = await run.finished;
    expect(result.status).toBe("error");
    expect(result.error).toBe("boom");
  });

  it("refuse un threshold incompatible avant de démarrer", () => {
    const s = scenario({ type: "constant-vus", vus: 1, durationSeconds: 1 }, [
      { metric: "http_req_failed", expression: "p(95)<1" },
    ]);
    expect(() => new LoadRun(s, deps())).toThrow(/Thresholds invalides/);
  });
});

describe("RunRegistry", () => {
  const registryDeps = (maxConcurrentRuns: number) => ({
    limits: { ...limits, load: { ...limits.load, maxConcurrentRuns } },
    createWorker: () => new InProcessWorker() as unknown as WorkerLike,
    maxWorkers: 1,
    detachGraceMs: 60_000,
    gracefulStopMs: 1000,
    ttlMs: 1000,
  });

  it("limite le nombre de tests simultanés et retrouve les tests par identifiant", async () => {
    const registry = new RunRegistry(registryDeps(1));
    const first = registry.create(scenario({ type: "constant-vus", vus: 1, durationSeconds: 30 }));
    first.subscribe(() => undefined);

    expect(() => registry.create(scenario({ type: "constant-vus", vus: 1, durationSeconds: 1 }))).toThrow(
      /déjà en cours/,
    );
    expect(registry.get(first.id)).toBe(first);

    first.cancel("fin du test", "cancelled");
    await first.finished;

    const second = registry.create(scenario({ type: "constant-vus", vus: 1, durationSeconds: 1 }));
    second.subscribe(() => undefined);
    expect((await second.finished).status).toBe("passed");
  });

  it("renvoie NOT_FOUND pour un identifiant inconnu ou invalide", () => {
    const registry = new RunRegistry(registryDeps(1));
    for (const id of ["00000000-0000-4000-8000-000000000000", "pas-un-uuid"]) {
      expect(() => registry.get(id)).toThrow(/introuvable/);
    }
  });

  it("refuse de lancer un test quand le registre n'est pas prêt", () => {
    const registry = new RunRegistry({
      ...registryDeps(1),
      assertReady: () => {
        throw new Error("worker manquant");
      },
    });
    expect(() => registry.create(scenario({ type: "constant-vus", vus: 1, durationSeconds: 1 }))).toThrow(
      /worker manquant/,
    );
  });
});