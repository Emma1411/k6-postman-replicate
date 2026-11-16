import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { COLLECTION_FORMAT, CollectionError, ENVIRONMENT_FORMAT, parseCollection, parseEnvironment } from "@/shared/schemas";
import {
  MAX_HISTORY,
  addHistory,
  clearAll,
  deleteCollection,
  getSetting,
  listCollections,
  listEnvironments,
  listHistory,
  listRuns,
  pruneRuns,
  saveCollection,
  saveEnvironment,
  saveRun,
  setSetting,
} from "@/client/storage/repositories";

const collection = (id: string, name = id) =>
  parseCollection({ format: COLLECTION_FORMAT, version: 1, id, name, items: [] });
const environment = (id: string) =>
  parseEnvironment({ format: ENVIRONMENT_FORMAT, version: 1, id, name: id, variables: [{ key: "base", value: "https://x.test" }] });

beforeEach(async () => {
  await clearAll();
});

describe("collections et environnements", () => {
  it("enregistre, liste et supprime", async () => {
    await saveCollection(collection("c1", "Premier"));
    await saveCollection(collection("c2"));
    expect((await listCollections()).map((c) => c.id).sort()).toEqual(["c1", "c2"]);

    await saveCollection(collection("c1", "Renommé"));
    expect((await listCollections()).find((c) => c.id === "c1")?.name).toBe("Renommé");

    await deleteCollection("c1");
    expect((await listCollections()).map((c) => c.id)).toEqual(["c2"]);
  });

  it("refuse d'enregistrer une collection invalide", async () => {
    const bad = { ...collection("c1"), items: [{ type: "dossier" }] } as never;
    await expect(saveCollection(bad)).rejects.toBeInstanceOf(CollectionError);
    expect(await listCollections()).toEqual([]);
  });

  it("gère les environnements", async () => {
    await saveEnvironment(environment("e1"));
    const [env] = await listEnvironments();
    expect(env.variables[0].key).toBe("base");
  });
});

describe("réglages", () => {
  it("renvoie la valeur par défaut puis la valeur enregistrée", async () => {
    expect(await getSetting("densite", "confortable")).toBe("confortable");
    await setSetting("densite", "compacte");
    expect(await getSetting("densite", "confortable")).toBe("compacte");
  });
});

describe("historique", () => {
  const entry = (n: number) => ({ id: `h${n}`, createdAt: n, kind: "request" as const, label: `Requête ${n}`, summary: {} });

  it("liste les plus récentes d'abord", async () => {
    for (const n of [1, 3, 2]) await addHistory(entry(n));
    expect((await listHistory(10)).map((h) => h.id)).toEqual(["h3", "h2", "h1"]);
    expect((await listHistory(2)).map((h) => h.id)).toEqual(["h3", "h2"]);
  });

  it(`ne garde que les ${MAX_HISTORY} dernières entrées`, async () => {
    for (let n = 1; n <= MAX_HISTORY + 5; n++) await addHistory(entry(n));
    const all = await listHistory(1000);
    expect(all).toHaveLength(MAX_HISTORY);
    expect(all[0].id).toBe(`h${MAX_HISTORY + 5}`);
    expect(all.at(-1)?.id).toBe("h6");
  });
});

describe("tests de charge en cours", () => {
  it("supprime les tests trop anciens", async () => {
    const now = 1_000_000;
    await saveRun({ runId: "vieux", startedAt: now - 7_200_000, scenarioName: "a", status: "running" });
    await saveRun({ runId: "recent", startedAt: now - 60_000, scenarioName: "b", status: "running" });
    await pruneRuns(3_600_000, now);
    expect((await listRuns()).map((r) => r.runId)).toEqual(["recent"]);
  });
});

describe("clearAll", () => {
  it("vide tous les espaces de stockage", async () => {
    await saveCollection(collection("c1"));
    await setSetting("a", 1);
    await addHistory({ id: "h", createdAt: 1, kind: "load", label: "x", summary: {} });
    await clearAll();
    expect(await listCollections()).toEqual([]);
    expect(await getSetting("a", null)).toBeNull();
    expect(await listHistory()).toEqual([]);
  });
});