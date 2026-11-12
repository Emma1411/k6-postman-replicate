import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { limits as appLimits, type Limits } from "@/server/config";
import { AppError } from "@/server/utils/errors";
import type { LoadScenario } from "@/shared/schemas";
import { LoadRun, type WorkerLike } from "./load-run";

export interface RegistryDeps {
  limits: Limits;
  createWorker: (index: number) => WorkerLike;
  maxWorkers: number;
  detachGraceMs: number;
  gracefulStopMs: number;
  /** Durée de conservation d'un test terminé. */
  ttlMs: number;
  /** Contrôle préalable (ex. le worker compilé existe). Lève une AppError si le registre ne peut pas lancer de test. */
  assertReady?: () => void;
}

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Tests de charge de ce serveur, en mémoire. Pas de base de données : un redémarrage les efface. */
export class RunRegistry {
  private readonly runs = new Map<string, LoadRun>();
  private readonly deps: RegistryDeps;

  constructor(deps: RegistryDeps) {
    this.deps = deps;
  }

  create(scenario: LoadScenario): LoadRun {
    this.deps.assertReady?.();

    const active = [...this.runs.values()].filter((run) => !run.isFinished).length;
    if (active >= this.deps.limits.load.maxConcurrentRuns) {
      throw new AppError("RATE_LIMITED", "Un test de charge est déjà en cours : attends sa fin ou annule-le.", {
        retryAfterSeconds: 10,
      });
    }

    const run = new LoadRun(scenario, {
      limits: this.deps.limits,
      createWorker: this.deps.createWorker,
      maxWorkers: this.deps.maxWorkers,
      detachGraceMs: this.deps.detachGraceMs,
      gracefulStopMs: this.deps.gracefulStopMs,
    });
    this.runs.set(run.id, run);

    void run.finished.then(() => {
      const timer = setTimeout(() => this.runs.delete(run.id), this.deps.ttlMs);
      timer.unref?.();
    });
    run.start();
    return run;
  }

  get(id: string): LoadRun {
    const run = RUN_ID.test(id) ? this.runs.get(id) : undefined;
    if (!run) throw new AppError("NOT_FOUND", "Test de charge introuvable (terminé depuis trop longtemps, ou serveur redémarré).");
    return run;
  }
}

const globalStore = globalThis as unknown as { __runRegistry?: RunRegistry };

/** Registre du serveur, conservé sur globalThis pour survivre au rechargement des modules en développement. */
export function getRegistry(): RunRegistry {
  if (!globalStore.__runRegistry) {
    const workerFile = path.resolve(process.cwd(), appLimits.load.workerPath);
    globalStore.__runRegistry = new RunRegistry({
      limits: appLimits,
      createWorker: () => new Worker(workerFile) as unknown as WorkerLike,
      maxWorkers: Math.max(1, Math.min(appLimits.load.maxWorkers, os.availableParallelism())),
      detachGraceMs: appLimits.load.detachGraceSeconds * 1000,
      gracefulStopMs: appLimits.load.gracefulStopSeconds * 1000,
      ttlMs: appLimits.load.runTtlSeconds * 1000,
      assertReady: () => {
        if (!fs.existsSync(workerFile)) {
          throw new AppError("INTERNAL_ERROR", "Le worker de charge n'est pas compilé. Lance « npm run build:worker ».");
        }
      },
    });
  }
  return globalStore.__runRegistry;
}