
import { buildLimits } from "@/server/config/limits";
import { parseEnv } from "@/server/config/env.schema";
import type { LoadRunDeps, WorkerLike } from "@/server/engine/runs/load-run";
import { RunRegistry } from "@/server/engine/runs/run-registry";
import { LoadScenarioSchema } from "@/shared/schemas";
import { InProcessWorker } from "./in-process-worker";
import {
  startTargetServer,
  type TargetServer,
} from "../target-server/server";

export type Target = TargetServer;

const limits = buildLimits(
  parseEnv({ ALLOW_PRIVATE_NETWORKS: "true" }),
);

export async function startTarget(): Promise<Target> {
  return startTargetServer();
}

export function makeScenario(
  baseUrl: string,
  executor: unknown,
  thresholds: unknown[] = [],
  requestPath = "/echo",
) {
  return LoadScenarioSchema.parse({
    name: "test de charge",
    workflow: {
      name: "w",
      variables: { base: baseUrl },
      steps: [
        {
          id: "s1",
          name: "requête",
          request: {
            method: "GET",
            url: `{{base}}${requestPath}`,
          },
          assertions: [{ type: "status", expected: 200 }],
        },
      ],
    },
    executor,
    thresholds,
  });
}

export function makeRegistry(maxConcurrentRuns = 2) {
  const deps: Partial<LoadRunDeps> = {
    limits,
    createWorker: () =>
      new InProcessWorker() as unknown as WorkerLike,
    maxWorkers: 1,
    detachGraceMs: 60_000,
    gracefulStopMs: 1000,
  };

  return new RunRegistry({
    limits: {
      ...limits,
      load: {
        ...limits.load,
        maxConcurrentRuns,
      },
    },
    createWorker: deps.createWorker!,
    maxWorkers: deps.maxWorkers!,
    detachGraceMs: deps.detachGraceMs!,
    gracefulStopMs: deps.gracefulStopMs!,
    ttlMs: 1000,
  });
}
