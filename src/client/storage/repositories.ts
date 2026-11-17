
import { parseCollection, parseEnvironment } from "@/shared/schemas";
import type { Collection, Environment } from "@/shared/schemas";
import { getDb, type HistoryEntry, type RunRecord, type StoredLoadResult } from "./db";

export const MAX_HISTORY = 200;

/* ───────── Collections et environnements ───────── */

export async function listCollections(): Promise<Collection[]> {
  return (await getDb()).getAll("collections");
}

/** Valide avant d'écrire : le stockage ne contient que des collections correctes. */
export async function saveCollection(collection: Collection): Promise<void> {
  await (await getDb()).put("collections", parseCollection(collection));
}

export async function deleteCollection(id: string): Promise<void> {
  await (await getDb()).delete("collections", id);
}

export async function listEnvironments(): Promise<Environment[]> {
  return (await getDb()).getAll("environments");
}

export async function saveEnvironment(environment: Environment): Promise<void> {
  await (await getDb()).put("environments", parseEnvironment(environment));
}

export async function deleteEnvironment(id: string): Promise<void> {
  await (await getDb()).delete("environments", id);
}

/* ───────── Réglages ───────── */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await (await getDb()).get("settings", key);
  return record === undefined ? fallback : (record.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await getDb()).put("settings", { key, value });
}

export async function listSettings(): Promise<Record<string, unknown>> {
  const records = await (await getDb()).getAll("settings");
  return Object.fromEntries(records.map((r) => [r.key, r.value]));
}

/* ───────── Historique (borné) ───────── */

export async function addHistory(entry: HistoryEntry): Promise<void> {
  const tx = (await getDb()).transaction("history", "readwrite");
  await tx.store.put(entry);

  const extra = (await tx.store.count()) - MAX_HISTORY;

  if (extra > 0) {
    let cursor = await tx.store.index("by-created").openCursor();

    for (let i = 0; cursor && i < extra; i++) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }

  await tx.done;
}

/** Les entrées les plus récentes d'abord. */
export async function listHistory(limit = 50): Promise<HistoryEntry[]> {
  const tx = (await getDb()).transaction("history");
  const out: HistoryEntry[] = [];

  let cursor = await tx.store.index("by-created").openCursor(null, "prev");

  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }

  return out;
}

/* ───────── Tests de charge en cours ───────── */

export async function saveRun(run: RunRecord): Promise<void> {
  await (await getDb()).put("runs", run);
}

export async function listRuns(): Promise<RunRecord[]> {
  return (await getDb()).getAll("runs");
}

export async function deleteRun(runId: string): Promise<void> {
  await (await getDb()).delete("runs", runId);
}

/** Supprime les tests plus anciens que `maxAgeMs` (le serveur les oublie après 15 minutes). */
export async function pruneRuns(maxAgeMs: number, now = Date.now()): Promise<void> {
  const tx = (await getDb()).transaction("runs", "readwrite");

  let cursor = await tx.store.index("by-started").openCursor(
    IDBKeyRange.upperBound(now - maxAgeMs, true),
  );

  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

/* ───────── Résultats de tests de charge ───────── */

export const MAX_RESULTS = 50;

export async function saveResult(result: StoredLoadResult): Promise<void> {
  const tx = (await getDb()).transaction("results", "readwrite");
  await tx.store.put(result);

  const extra = (await tx.store.count()) - MAX_RESULTS;

  if (extra > 0) {
    let cursor = await tx.store.index("by-saved").openCursor();

    for (let i = 0; cursor && i < extra; i++) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }

  await tx.done;
}

/** Les résultats les plus récents d'abord. */
export async function listResults(limit = MAX_RESULTS): Promise<StoredLoadResult[]> {
  const tx = (await getDb()).transaction("results");
  const out: StoredLoadResult[] = [];

  let cursor = await tx.store.index("by-saved").openCursor(null, "prev");

  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }

  return out;
}

export async function getResult(id: string): Promise<StoredLoadResult | undefined> {
  return (await getDb()).get("results", id);
}

export async function deleteResult(id: string): Promise<void> {
  await (await getDb()).delete("results", id);
}

/* ───────── Tout effacer ───────── */

export async function clearAll(): Promise<void> {
  const db = await getDb();

  const names = [
    "collections",
    "environments",
    "history",
    "settings",
    "runs",
    "results",
  ] as const;

  const tx = db.transaction([...names], "readwrite");

  await Promise.all([
    ...names.map((name) => tx.objectStore(name).clear()),
    tx.done,
  ]);
}
