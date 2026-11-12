import type { Limits } from "@/server/config/limits";
import type { WindowDelta } from "@/server/engine/metrics/types";
import type { LoadScenario } from "@/shared/schemas";

export interface WorkerConfig {
  workerIndex: number;
  workerCount: number;
  scenario: LoadScenario;
  /** Heure de départ commune à tous les workers (Date.now). */
  startAtMs: number;
  limits: Limits;
  gracefulStopMs: number;
}

/** Retard de la boucle d'événements du worker depuis le dernier envoi, en millisecondes. */
export interface LoopStats {
  p99Ms: number;
  maxMs: number;
}

export type MainToWorker =
  | { type: "start"; config: WorkerConfig }
  | { type: "flush"; seq: number }
  | { type: "abort" };

export type WorkerToMain =
  | { type: "ready" }
  | { type: "delta"; seq: number; delta: WindowDelta; loop: LoopStats }
  /** Dernier envoi, quand l'executor est terminé (avec ou sans erreur). */
  | { type: "done"; delta: WindowDelta; loop: LoopStats }
  | { type: "error"; message: string };