import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { COLLECTION_FORMAT, CollectionError, ENVIRONMENT_FORMAT, parseCollection, parseEnvironment } from "@/shared/schemas";
import { clearAll, listCollections, listEnvironments, saveCollection, saveEnvironment, setSetting } from "@/client/storage/repositories";
import {
  WORKSPACE_FORMAT,
  exportWorkspace,
  importWorkspace,
  parseWorkspace,
  planImport,
  previewImport,
  workspaceToJson,
} from "@/client/storage/workspace-io";

const SECRETS = ["tok-secret", "pwd-secret", "key-secret", "var-secret", "Bearer header-secret", "cookie-secret", "param-secret"];

const withSecrets = () =>
  parseCollection({
    format: COLLECTION_FORMAT,
    version: 1,
    id: "c1",
    name: "Avec secrets",
    variables: [
      { key: "base", value: "https://api.test" },
      { key: "apiToken", value: "var-secret", secret: true },
    ],
    auth: { type: "bearer", token: "tok-secret" },
    items: [
      {
        type: "folder",
        id: "f1",
        name: "Dossier",
        auth: { type: "basic", username: "emma", password: "pwd-secret" },
        items: [
          {
            type: "request",
            id: "r1",
            name: "Requête",
            request: {
              method: "GET",
              url: "{{base}}/users",
              headers: [
                { key: "Authorization", value: "Bearer header-secret" },
                { key: "Cookie", value: "cookie-secret" },
                { key: "Accept", value: "application/json" },
              ],
              params: [
                { key: "api_key", value: "param-secret" },
                { key: "page", value: "2" },
              ],
              auth: { type: "apiKey", key: "X-Key", value: "key-secret" },
            },
          },
        ],
      },
    ],
  });

beforeEach(async () => {
  await clearAll();
  await saveCollection(withSecrets());
  await saveEnvironment(
    parseEnvironment({
      format: ENVIRONMENT_FORMAT,
      version: 1,
      id: "e1",
      name: "Prod",
      variables: [{ key: "password", value: "var-secret", secret: true }],
    }),
  );
  await setSetting("densite", "compacte");
});

describe("exportWorkspace", () => {
  it("masque les secrets par défaut et garde le reste", async () => {
    const json = workspaceToJson(await exportWorkspace());
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(json).toContain("https://api.test");
    expect(json).toContain("application/json");
    expect(json).toContain("emma");

    const exported = JSON.parse(json);
    expect(exported.format).toBe(WORKSPACE_FORMAT);
    expect(exported.secretsIncluded).toBe(false);
    expect(exported.settings).toEqual({ densite: "compacte" });
  });

  it("garde les secrets sur demande", async () => {
    const json = workspaceToJson(await exportWorkspace({ includeSecrets: true }));
    for (const secret of SECRETS) expect(json).toContain(secret);
    expect(JSON.parse(json).secretsIncluded).toBe(true);
  });

  it("produit des collections qui restent valides", async () => {
    const exported = await exportWorkspace();
    expect(() => parseWorkspace(workspaceToJson(exported))).not.toThrow();
  });
});

describe("parseWorkspace", () => {
  it("refuse un fichier d'un autre format ou d'une autre version", () => {
    expect(() => parseWorkspace("pas du json")).toThrow(/JSON/);
    expect(() => parseWorkspace({ format: "autre" })).toThrow(CollectionError);
    expect(() => parseWorkspace({ format: WORKSPACE_FORMAT, version: 2 })).toThrow(/Version/);
  });

  it("indique le chemin de la collection invalide", () => {
    try {
      parseWorkspace({ format: WORKSPACE_FORMAT, version: 1, collections: [{ format: COLLECTION_FORMAT, version: 1 }] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CollectionError);
      expect((err as CollectionError).path).toContain("collections[0]");
    }
  });

  it("limite le nombre d'éléments", () => {
    const many = Array.from({ length: 201 }, () => ({}));
    expect(() => parseWorkspace({ format: WORKSPACE_FORMAT, version: 1, collections: many })).toThrow(/Trop d'éléments/);
  });
});

describe("import", () => {
  it("restitue l'espace de travail exporté avec les secrets", async () => {
    const exported = await exportWorkspace({ includeSecrets: true });
    await clearAll();
    await importWorkspace(parseWorkspace(workspaceToJson(exported)), "merge");
    expect(await listCollections()).toEqual(exported.collections);
    expect(await listEnvironments()).toEqual(exported.environments);
  });

  it("planifie ajouts, remplacements et suppressions", () => {
    const ws = parseWorkspace({
      format: WORKSPACE_FORMAT,
      version: 1,
      collections: [
        { format: COLLECTION_FORMAT, version: 1, id: "c1", name: "Existante", items: [] },
        { format: COLLECTION_FORMAT, version: 1, id: "c9", name: "Nouvelle", items: [] },
      ],
      environments: [],
    });
    const existing = {
      collections: [
        { id: "c1", name: "Ancienne" },
        { id: "c2", name: "À retirer" },
      ],
      environments: [{ id: "e1", name: "Prod" }],
    };

    const merge = planImport(ws, "merge", existing);
    expect(merge.collections.added.map((c) => c.id)).toEqual(["c9"]);
    expect(merge.collections.replaced.map((c) => c.id)).toEqual(["c1"]);
    expect(merge.collections.removed).toEqual([]);
    expect(merge.secretsMasked).toBe(true);

    const replace = planImport(ws, "replace", existing);
    expect(replace.collections.removed.map((c) => c.id)).toEqual(["c2"]);
    expect(replace.environments.removed.map((e) => e.id)).toEqual(["e1"]);
  });

  it("le mode « remplacer » supprime ce qui n'est pas dans le fichier", async () => {
    const ws = parseWorkspace({
      format: WORKSPACE_FORMAT,
      version: 1,
      collections: [{ format: COLLECTION_FORMAT, version: 1, id: "neuve", name: "Neuve", items: [] }],
      environments: [],
    });
    expect((await previewImport(ws, "replace")).collections.removed.map((c) => c.id)).toEqual(["c1"]);
    await importWorkspace(ws, "replace");
    expect((await listCollections()).map((c) => c.id)).toEqual(["neuve"]);
    expect(await listEnvironments()).toEqual([]);
  });

  it("le mode « fusionner » garde l'existant", async () => {
    const ws = parseWorkspace({ format: WORKSPACE_FORMAT, version: 1, collections: [], environments: [] });
    await importWorkspace(ws, "merge");
    expect(await listCollections()).toHaveLength(1);
  });
});