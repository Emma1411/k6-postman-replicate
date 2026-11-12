import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { LoadRun, type WorkerLike } from "@/server/engine/runs/load-run";
import { LoadScenarioSchema } from "@/shared/schemas";
import { startTargetServer, type TargetServer } from "../target-server/server";

const workerFile = path.resolve(process.cwd(), "dist/workers/load-worker.js");
const limits = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" }));

let server: TargetServer;
beforeAll(async () => {
  server = await startTargetServer();
});
afterAll(async () => {
  await server.close();
});

describe.skipIf(!existsSync(workerFile))("worker_threads réels (nécessite npm run build:worker)", () => {
  it("exécute un test complet dans des threads séparés", async () => {
    const scenario = LoadScenarioSchema.parse({
      name: "threads",
      workflow: {
        name: "w",
        variables: { base: server.url },
        steps: [
          {
            id: "s1",
            name: "echo",
            request: { method: "GET", url: "{{base}}/echo" },
            assertions: [{ type: "jsonPath", path: "$.method", operator: "equals", value: "GET" }],
          },
        ],
      },
      executor: { type: "constant-vus", vus: 4, durationSeconds: 2 },
      thresholds: [{ metric: "http_req_failed", expression: "rate<0.01" }],
    });

    const run = new LoadRun(scenario, {
      limits,
      createWorker: () => new Worker(workerFile) as unknown as WorkerLike,
      maxWorkers: 2,
      detachGraceMs: 60_000,
      gracefulStopMs: 2000,
    });
    run.subscribe(() => undefined);
    run.start();
    const result = await run.finished;

    expect(result.status).toBe("passed");
    expect(result.snapshot.http_reqs.count).toBeGreaterThan(20);
    expect(result.snapshot.checks.rate).toBe(1);
    expect(result.snapshot.vus.max).toBe(4);
    expect(result.generator.workers).toBe(2);
  }, 20_000);
});