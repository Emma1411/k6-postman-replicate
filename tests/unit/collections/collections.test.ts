import { describe, expect, it } from "vitest";
import {
  collectionToWorkflow,
  findItem,
  mergeVariables,
  resolveAuth,
  resolveRequest,
  walkRequests,
} from "@/shared/collections/utils";
import { COLLECTION_FORMAT, CollectionError, ENVIRONMENT_FORMAT, parseCollection, parseEnvironment, type FolderItem, type RequestItem } from "@/shared/schemas";

const request = (id: string, authMode: "inherit" | "own", extra: Record<string, unknown> = {}, requestExtra: Record<string, unknown> = {}) => ({
  type: "request",
  id,
  name: `Requête ${id}`,
  authMode,
  request: { method: "GET", url: `{{base}}/${id}`, ...requestExtra },
  ...extra,
});

const sample = () =>
  parseCollection({
    format: COLLECTION_FORMAT,
    version: 1,
    id: "col",
    name: "Boutique",
    variables: [
      { key: "base", value: "http://collection", enabled: true },
      { key: "token", value: "tc", enabled: true },
      { key: "desactivee", value: "x", enabled: false },
    ],
    auth: { type: "bearer", token: "{{token}}" },
    items: [
      {
        type: "folder",
        id: "dossier",
        name: "Utilisateurs",
        auth: { type: "basic", username: "u", password: "p" },
        items: [
          request("r1", "inherit", { tests: [{ type: "status", expected: 200 }], extract: [{ variable: "id", from: "jsonPath", path: "$.id" }] }),
          request("r2", "own", {}, { auth: { type: "apiKey", key: "X-Key", value: "k", in: "header" } }),
          { type: "folder", id: "sous", name: "Sous-dossier", items: [request("r3", "inherit", { scripts: { test: "pm.test('x', () => {});" } })] },
        ],
      },
      request("r4", "inherit"),
      request("r5", "own"),
    ],
  });

describe("parseCollection", () => {
  const base = { format: COLLECTION_FORMAT, version: 1, id: "c", name: "C", items: [] as unknown[] };

  it("applique les valeurs par défaut", () => {
    const c = parseCollection({ ...base, items: [{ type: "request", id: "r", name: "R", request: { method: "GET", url: "http://x" } }] });
    const item = c.items[0] as RequestItem;
    expect(c.variables).toEqual([]);
    expect(item.authMode).toBe("own");
    expect(item.tests).toEqual([]);
    expect(item.request.params).toEqual([]);
    expect(item.request.followRedirects).toBe(true);
  });

  it("situe l'erreur dans l'arborescence", () => {
    const bad = { ...base, items: [{ type: "folder", id: "f", name: "F", items: [{ type: "request", id: "r", name: "R", request: { method: "FETCH", url: "x" } }] }] };
    try {
      parseCollection(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CollectionError);
      expect((e as CollectionError).path).toContain("items[0].items[0]");
    }
  });

  it("refuse les identifiants dupliqués, les types inconnus et un mauvais format", () => {
    const r = (id: string) => ({ type: "request", id, name: "R", request: { method: "GET", url: "x" } });
    expect(() => parseCollection({ ...base, items: [r("a"), r("a")] })).toThrow(/dupliqué/);
    expect(() => parseCollection({ ...base, items: [{ type: "autre" }] })).toThrow(/type/);
    expect(() => parseCollection({ ...base, format: "autre" })).toThrow(CollectionError);
    expect(() => parseCollection({ ...base, id: "id invalide" })).toThrow(/Identifiant/);
  });

  it("valide les environnements", () => {
    const env = parseEnvironment({ format: ENVIRONMENT_FORMAT, version: 1, id: "e", name: "E", variables: [{ key: "a", value: "1" }] });
    expect(env.variables[0]).toEqual({ key: "a", value: "1", enabled: true, secret: false });
    expect(() => parseEnvironment({ format: ENVIRONMENT_FORMAT, version: 1, id: "e", name: "E", variables: [{ key: "mauvais nom", value: "1" }] })).toThrow(CollectionError);
  });
});

describe("parcours et résolution", () => {
  it("parcourt les requêtes dans l'ordre, avec leurs dossiers parents", () => {
    const seen: string[] = [];
    walkRequests(sample().items, (item, ancestors) => seen.push(`${item.id}:${ancestors.map((a) => a.id).join("/")}`));
    expect(seen).toEqual(["r1:dossier", "r2:dossier", "r3:dossier/sous", "r4:", "r5:"]);
  });

  it("retrouve un élément et ses ancêtres", () => {
    const c = sample();
    expect(findItem(c, "r3")?.ancestors.map((a) => a.id)).toEqual(["dossier", "sous"]);
    expect(findItem(c, "sous")?.item.type).toBe("folder");
    expect(findItem(c, "inconnu")).toBeNull();
  });

  it("résout l'authentification : propre, du dossier le plus proche, puis de la collection", () => {
    const c = sample();
    const auth = (id: string) => {
      const found = findItem(c, id)!;
      return resolveAuth(c, found.item as RequestItem, found.ancestors);
    };
    expect(auth("r1")).toEqual({ type: "basic", username: "u", password: "p" }); // hérite du dossier
    expect(auth("r2")).toEqual({ type: "apiKey", key: "X-Key", value: "k", in: "header" }); // propre
    expect(auth("r3")).toEqual({ type: "basic", username: "u", password: "p" }); // le sous-dossier n'en a pas : remonte
    expect(auth("r4")).toEqual({ type: "bearer", token: "{{token}}" }); // hérite de la collection
    expect(auth("r5")).toEqual({ type: "none" }); // propre, sans authentification
  });

  it("n'applique aucune authentification quand rien n'est défini", () => {
    const c = parseCollection({ format: COLLECTION_FORMAT, version: 1, id: "c", name: "C", items: [request("r", "inherit")] });
    expect(resolveAuth(c, c.items[0] as RequestItem, [])).toEqual({ type: "none" });
  });

  it("fusionne les variables : l'environnement surcharge, les variables désactivées sont ignorées", () => {
    const env = parseEnvironment({
      format: ENVIRONMENT_FORMAT,
      version: 1,
      id: "e",
      name: "E",
      variables: [{ key: "base", value: "http://env" }, { key: "extra", value: "1" }, { key: "token", value: "x", enabled: false }],
    });
    expect(mergeVariables(sample())).toEqual({ base: "http://collection", token: "tc" });
    expect(mergeVariables(sample(), env)).toEqual({ base: "http://env", token: "tc", extra: "1" });
  });

  it("résout une requête prête à envoyer", () => {
    const resolved = resolveRequest(sample(), "r1");
    expect(resolved?.request.auth).toEqual({ type: "basic", username: "u", password: "p" });
    expect(resolved?.variables.base).toBe("http://collection");
    expect(resolved?.tests).toHaveLength(1);
    expect(resolved?.extract).toHaveLength(1);
    expect(resolveRequest(sample(), "dossier")).toBeNull();
    expect(resolveRequest(sample(), "inconnu")).toBeNull();
  });
});

describe("collectionToWorkflow", () => {
  it("produit un workflow avec les requêtes dans l'ordre, l'authentification résolue et les tests", () => {
    const { workflow, warnings } = collectionToWorkflow(sample());
    expect(workflow.name).toBe("Boutique");
    expect(workflow.steps.map((s) => s.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(workflow.steps[0].request.auth).toEqual({ type: "basic", username: "u", password: "p" });
    expect(workflow.steps[3].request.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(workflow.steps[0].assertions).toEqual([{ type: "status", expected: 200 }]);
    expect(workflow.steps[0].extract[0]).toMatchObject({ variable: "id", from: "jsonPath", path: "$.id" });
    expect(workflow.steps.every((s) => s.onError === "continue")).toBe(true);
    expect(workflow.variables).toEqual({ base: "http://collection", token: "tc" });
    expect(warnings.join(" ")).toContain("scripts pm.*"); // r3 a un script
  });

  it("applique l'environnement et le mode d'arrêt demandés", () => {
    const env = parseEnvironment({ format: ENVIRONMENT_FORMAT, version: 1, id: "e", name: "E", variables: [{ key: "base", value: "http://env" }] });
    const { workflow } = collectionToWorkflow(sample(), { environment: env, onError: "stop" });
    expect(workflow.variables.base).toBe("http://env");
    expect(workflow.steps.every((s) => s.onError === "stop")).toBe(true);
  });

  it("se limite à un dossier, en gardant l'authentification héritée", () => {
    const { workflow } = collectionToWorkflow(sample(), { folderId: "sous" });
    expect(workflow.name).toBe("Boutique / Sous-dossier");
    expect(workflow.steps.map((s) => s.id)).toEqual(["r3"]);
    expect(workflow.steps[0].request.auth).toEqual({ type: "basic", username: "u", password: "p" }); // hérité du dossier parent
  });

  it("refuse un dossier inconnu, une sélection vide et un workflow trop grand", () => {
    expect(() => collectionToWorkflow(sample(), { folderId: "inconnu" })).toThrow(/introuvable/);
    expect(() => collectionToWorkflow(sample(), { folderId: "r1" })).toThrow(/introuvable/);

    const empty = parseCollection({ format: COLLECTION_FORMAT, version: 1, id: "c", name: "C", items: [{ type: "folder", id: "f", name: "F", items: [] }] });
    expect(() => collectionToWorkflow(empty)).toThrow(/Aucune requête/);

    const many = parseCollection({
      format: COLLECTION_FORMAT,
      version: 1,
      id: "c",
      name: "C",
      items: Array.from({ length: 201 }, (_, i) => request(`r${i}`, "own")),
    });
    expect(() => collectionToWorkflow(many)).toThrow(/Trop de requêtes/);
  });
});