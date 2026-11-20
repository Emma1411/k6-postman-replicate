import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Collection, Environment, LoadScenario } from "@/shared/schemas";
import type { LoadRunResult, WindowPoint } from "@/shared/types/load-result";

export const DB_NAME = "api-engineering-platform";
export const DB_VERSION = 2;

export interface HistoryEntry {
  id: string;
  createdAt: number;
  kind: "request" | "workflow" | "load";
  label: string;
  summary: Record<string, unknown>;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

/** Test de charge lancé depuis ce navigateur : sert à se rattacher à son flux après un rechargement. */
export interface RunRecord {
  runId: string;
  startedAt: number;
  scenarioName: string;
  status: "running" | "finished" | "unknown";
  /** Le scénario lancé : le serveur ne le renvoie pas quand on se rattache. */
  scenario?: LoadScenario;
}

/** Résultat d'un test terminé, conservé dans ce navigateur pour l'onglet « Tests précédents ». */
export interface StoredLoadResult {
  id: string;
  savedAt: number;
  name: string;
  scenario: LoadScenario | null;
  result: LoadRunResult;
  points: WindowPoint[];
  startedAt?: number | null;
}

interface WorkspaceDB extends DBSchema {
  collections: { key: string; value: Collection };
  environments: { key: string; value: Environment };
  history: {
    key: string;
    value: HistoryEntry;
    indexes: { "by-created": number };
  };
  settings: { key: string; value: SettingRecord };
  runs: { key: string; value: RunRecord; indexes: { "by-started": number } };
  results: {
    key: string;
    value: StoredLoadResult;
    indexes: { "by-saved": number };
  };
}

export type Db = IDBPDatabase<WorkspaceDB>;

/** Le stockage du navigateur est indisponible ou a échoué. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  dbPromise ??= openDB<WorkspaceDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("collections", { keyPath: "id" });
        db.createObjectStore("environments", { keyPath: "id" });
        db.createObjectStore("history", { keyPath: "id" }).createIndex(
          "by-created",
          "createdAt",
        );
        db.createObjectStore("settings", { keyPath: "key" });
        db.createObjectStore("runs", { keyPath: "runId" }).createIndex(
          "by-started",
          "startedAt",
        );
      }
      if (oldVersion < 2) {
        db.createObjectStore("results", { keyPath: "id" }).createIndex(
          "by-saved",
          "savedAt",
        );
      }
    },
    terminated() {
      dbPromise = null;
    },
  }).catch(() => {
    dbPromise = null;
    throw new StorageError(
      "Le stockage du navigateur est indisponible (navigation privée ou stockage désactivé ?). Tes données ne seront pas conservées.",
    );
  });
  return dbPromise;
}
