import type { ExecutorConfig } from "@/shared/schemas";

export interface IterationInfo {
  /** Identifiant global du VU, de 1 à N, unique entre tous les workers. */
  vu: number;
  /** Numéro de l'itération (par VU pour les executors à VUs, global pour les executors à cadence). */
  iteration: number;
}

/** Exécute une itération du workflow. Ne doit jamais lever d'erreur. */
export type IterationFn = (info: IterationInfo) => Promise<void>;

export interface ExecutorRecorder {
  setVus(count: number): void;
  recordDropped(count: number): void;
}

export interface ExecutorRun {
  executor: ExecutorConfig;
  /** Heure de départ commune à tous les workers (Date.now). */
  startAtMs: number;
  /** Position de ce worker (0 à shareCount - 1) et nombre total de workers. */
  shareIndex: number;
  shareCount: number;
  runIteration: IterationFn;
  recorder: ExecutorRecorder;
  /** Annule tout : le test s'arrête, ou le délai d'arrêt gracieux est dépassé. */
  controller: AbortController;
  /** Temps laissé aux itérations en cours après la fin du test avant annulation forcée (10 s par défaut). */
  gracefulStopMs?: number;
}