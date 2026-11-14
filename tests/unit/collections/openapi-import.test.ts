import { describe, expect, it } from "vitest";
import { walkRequests } from "@/shared/collections/utils";
import { importOpenApi } from "@/shared/collections/openapi-import";
import { CollectionError, type Collection, type FolderItem, type RequestItem } from "@/shared/schemas";
import { validateJsonSchema } from "@/server/engine/vu/json-schema";
import { ids } from "../../helpers/postman-fixtures";
import { petstore } from "../../helpers/openapi-fixtures";

const run = (spec: unknown) => importOpenApi(spec, { idFactory: ids() });

function requests(collection: Collection): RequestItem[] {
  const out: RequestItem[] = [];
  walkRequests(collection.items, (item) => out.push(item));
  return out;
}

function named(collection: Collection, name: string): RequestItem {
  const found = requests(collection).find((r) => r.name === name);
  if (!found) throw new Error(`Requête introuvable : ${name}`);
  return found;
}

const result = run(petstore());
const c = result.value;
const warnings = result.warnings.join("\n");
const body = (name: string) => named(c, name).request.body as { content: string };

describe("structure", () => {
  it("importe le titre, la description et le serveur (variables de serveur substituées)", () => {
    expect(c.name).toBe("Petstore");
    expect(c.description).toBe("Démo");
    expect(c.variables[0]).toEqual({ key: "baseUrl", value: "https://api.exemple.com/v1", enabled: true, secret: false });
    expect(warnings).toContain("2 serveurs");
  });

  it("range les opérations par tag, dans l'ordre de la section « tags »", () => {
    const folders = c.items.filter((i): i is FolderItem => i.type === "folder");
    expect(folders.map((f) => f.name)).toEqual(["pets", "admin"]);
    expect(folders[0].description).toBe("Animaux");
    expect(folders[0].items.map((i) => i.name)).toEqual(["Lister", "Créer", "Détail", "DELETE /pets/{petId}"]);
    expect(folders[1].items.map((i) => i.name)).toEqual(["GET /orders/{orderId}", "Avec cookie", "Avec OAuth"]);
  });

  it("place les opérations sans tag à la racine, nommées par résumé puis par méthode et chemin", () => {
    const root = c.items.filter((i) => i.type === "request").map((i) => i.name);
    expect(root).toEqual(["Santé", "POST /login", "POST /upload", "Ancien", "GET /search", "POST /people", "POST /samples", "POST /xml", "POST /vnd"]);
    expect(result.stats.folders).toBe(2);
    expect(result.stats.requests).toBe(16);
  });

  it("ignore TRACE et le signale", () => {
    expect(warnings).toContain("TRACE");
    expect(result.stats.skipped).toBe(1);
  });
});

describe("paramètres", () => {
  it("convertit les paramètres de chemin en variables avec leur exemple", () => {
    const detail = named(c, "Détail").request;
    expect(detail.url).toBe("{{baseUrl}}/pets/{{petId}}");
    expect(c.variables.find((v) => v.key === "petId")?.value).toBe("7");
  });

  it("crée une variable vide et avertit quand un paramètre de chemin n'a pas d'exemple", () => {
    expect(named(c, "GET /orders/{orderId}").request.url).toBe("{{baseUrl}}/orders/{{orderId}}");
    expect(c.variables.find((v) => v.key === "orderId")?.value).toBe("");
    expect(warnings).toContain("orderId");
  });

  it("active les paramètres requis et désactive les facultatifs, en résolvant les $ref", () => {
    const list = named(c, "Lister").request;
    expect(list.headers).toEqual([{ key: "X-Trace", value: "t-1", enabled: true }]);
    expect(list.params).toEqual([
      { key: "limit", value: "20", enabled: false },
      { key: "q", value: "", enabled: false },
    ]);
    expect(warnings).toContain("cookie");
  });

  it("rend les noms de variables valides", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "http://x" }],
      paths: { "/x/{pet id}": { get: { parameters: [{ name: "pet id", in: "path", required: true, schema: { type: "string" }, example: "a" }], responses: {} } } },
    };
    const r = run(spec).value;
    expect((r.items[0] as RequestItem).request.url).toBe("{{baseUrl}}/x/{{pet_id}}");
    expect(r.variables.some((v) => v.key === "pet_id" && v.value === "a")).toBe(true);
  });
});

describe("corps de requête", () => {
  it("utilise l'exemple du schéma, en résolvant les $ref", () => {
    const post = named(c, "Créer").request.body as { type: string; content: string };
    expect(post.type).toBe("json");
    expect(JSON.parse(post.content)).toEqual({ name: "Rex", tag: "string" });
    expect(post.content).toContain('\n  "name"'); // indenté
  });

  it("génère une valeur par type, format, enum, oneOf et default, sans les propriétés en lecture seule", () => {
    expect(JSON.parse(body("POST /samples").content)).toEqual({
      count: 5,
      ratio: 0,
      active: false,
      when: "2024-01-01T00:00:00Z",
      email: "user@example.com",
      id: "00000000-0000-4000-8000-000000000000",
      kind: "a",
      tags: [0],
      nested: { x: "dx" },
      either: "first",
      nothing: "string",
    });
  });

  it("ne boucle pas sur une référence circulaire", () => {
    expect(JSON.parse(body("POST /people").content)).toEqual({ name: "string", friends: [] });
  });

  it("convertit urlencoded, multipart (champ fichier signalé) et XML", () => {
    expect(named(c, "POST /login").request.body).toEqual({
      type: "urlencoded",
      fields: [{ key: "user", value: "emma", enabled: true }, { key: "pass", value: "string", enabled: true }],
    });
    expect(named(c, "POST /upload").request.body).toEqual({
      type: "form-data",
      fields: [{ kind: "text", key: "title", value: "t", enabled: true }],
    });
    expect(warnings).toContain("file");
    expect(body("POST /xml").content).toBe("<root>\n  <name>A</name>\n  <count>0</count>\n</root>");
    expect(named(c, "POST /xml").request.headers).toEqual([]);
  });

  it("ajoute le Content-Type pour un type JSON particulier", () => {
    const vnd = named(c, "POST /vnd").request;
    expect(vnd.body.type).toBe("json");
    expect(vnd.headers).toEqual([{ key: "Content-Type", value: "application/vnd.api+json", enabled: true }]);
  });

  it("retire le body d'une requête GET en le signalant", () => {
    expect(named(c, "GET /search").request.body).toEqual({ type: "none" });
    expect(warnings).toContain("GET");
  });

  it("préfère l'exemple explicite à la génération", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "http://x" }],
      paths: {
        "/a": {
          post: {
            requestBody: { content: { "application/json": { example: { fixe: true }, schema: { type: "object", properties: { autre: { type: "string" } } } } } },
            responses: {},
          },
        },
      },
    };
    const item = run(spec).value.items[0] as RequestItem;
    expect(JSON.parse((item.request.body as { content: string }).content)).toEqual({ fixe: true });
  });
});

describe("authentification", () => {
  it("applique la sécurité globale à la collection, avec des variables à renseigner", () => {
    expect(c.auth).toEqual({ type: "bearer", token: "{{bearerAuth_token}}" });
    const token = c.variables.find((v) => v.key === "bearerAuth_token");
    expect(token).toMatchObject({ value: "", secret: true });
    expect(named(c, "Lister").authMode).toBe("inherit");
  });

  it("gère la surcharge par opération : aucune, clé d'API, cookie, OAuth", () => {
    expect(named(c, "Santé")).toMatchObject({ authMode: "own", request: { auth: { type: "none" } } });
    expect(named(c, "DELETE /pets/{petId}")).toMatchObject({
      authMode: "own",
      request: { auth: { type: "apiKey", key: "X-API-Key", value: "{{apiKeyAuth_value}}", in: "header" } },
    });
    expect(c.variables.find((v) => v.key === "apiKeyAuth_value")?.secret).toBe(true);

    expect(named(c, "Avec cookie")).toMatchObject({ authMode: "own", request: { auth: { type: "none" } } });
    expect(named(c, "Avec OAuth").request.auth).toEqual({ type: "bearer", token: "{{oauth_token}}" });
    expect(warnings).toContain("OAuth 2.0");
  });
});

describe("tests de contrat", () => {
  it("génère le statut attendu et la conformité au schéma, $ref et allOf résolus", () => {
    const list = named(c, "Lister").tests;
    expect(list[0]).toEqual({ type: "status", expected: 200 });
    expect(list[1]).toMatchObject({ type: "jsonSchema", label: "Réponse conforme au schéma OpenAPI" });

    const schema = (list[1] as { schema: any }).schema;
    expect(schema.type).toBe("array");
    const pet = schema.items;
    expect(pet.type).toBe("object");
    expect(pet.required).toEqual(["name", "id"]);
    expect(pet.properties.tag.type).toEqual(["string", "null"]); // nullable (OpenAPI 3.0)
    expect(pet.properties.id).toEqual({ type: "integer" });
    expect(pet.properties.status).toEqual({ type: "string", enum: ["available", "sold"] });
    expect(pet.properties.born).toEqual({ type: "string" }); // le format n'est pas validé
    // la référence circulaire Person → friends → Person s'arrête sur un schéma vide
    expect(pet.properties.owner.properties.friends).toEqual({ type: "array", items: {} });
  });

  it("couvre création, suppression et santé", () => {
    expect(named(c, "Créer").tests.map((t) => t.type)).toEqual(["status", "jsonSchema"]);
    expect((named(c, "Créer").tests[0] as { expected: number }).expected).toBe(201);
    expect(named(c, "DELETE /pets/{petId}").tests).toEqual([{ type: "status", expected: 204 }]);
    expect((named(c, "Santé").tests[1] as { schema: unknown }).schema).toEqual({
      type: "object",
      properties: { status: { type: "string", enum: ["ok"] } },
      required: ["status"],
    });
  });

  it("n'invente pas d'assertion de schéma quand plusieurs réponses 2xx diffèrent", () => {
    expect(named(c, "Ancien").tests).toEqual([{ type: "status", expected: [200, 201] }]);
    expect(warnings).toContain("plusieurs réponses 2xx");
  });

  it("ne génère rien sans réponse 2xx", () => {
    expect(named(c, "GET /search").tests).toEqual([]);
  });

  it("n'utilise que des mots-clés que le moteur sait valider", () => {
    const schemas = requests(c).flatMap((r) => r.tests.filter((t) => t.type === "jsonSchema"));
    expect(schemas.length).toBeGreaterThan(2);
    for (const test of schemas) {
      expect(() => validateJsonSchema({}, (test as { schema: unknown }).schema)).not.toThrow();
    }
  });

  it("le schéma généré accepte une réponse conforme et refuse les autres", () => {
    const schema = (named(c, "Détail").tests[1] as { schema: unknown }).schema;
    const valid = { name: "Rex", tag: null, id: 1, status: "sold", born: "2020", owner: { name: "x", friends: [{ autre: 1 }] } };
    expect(validateJsonSchema(valid, schema)).toEqual([]);

    const issues = validateJsonSchema({ name: 5, id: "x", status: "perdu" }, schema);
    const paths = issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["$.name", "$.id", "$.status"]));
  });
});

describe("références et propriétés particulières", () => {
  const base = (extra: Json) => ({ openapi: "3.1.0", info: { title: "T", version: "1" }, servers: [{ url: "http://x" }], ...extra });
  type Json = Record<string, unknown>;

  it("gère les types multiples d'OpenAPI 3.1, les bornes et les propriétés en écriture seule", () => {
    const spec = base({
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["n", "motDePasse"],
                      properties: {
                        n: { type: ["integer", "null"], minimum: 1, maximum: 9 },
                        nom: { type: "string", minLength: 2, maxLength: 5 },
                        liste: { type: "array", items: { type: "string" }, minItems: 1 },
                        motDePasse: { type: "string", writeOnly: true },
                        libre: { oneOf: [{ type: "string" }, { type: "integer" }] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const schema = ((run(spec).value.items[0] as RequestItem).tests[1] as { schema: any }).schema;
    expect(schema.required).toEqual(["n"]); // motDePasse n'apparaît jamais dans une réponse
    expect(schema.properties.motDePasse).toBeUndefined();
    expect(schema.properties.n).toEqual({ type: ["integer", "null"], minimum: 1, maximum: 9 });
    expect(schema.properties.nom).toEqual({ type: "string", minLength: 2, maxLength: 5 });
    expect(schema.properties.liste).toEqual({ type: "array", items: { type: "string" }, minItems: 1 });
    expect(schema.properties.libre).toEqual({}); // oneOf : aucune contrainte
  });

  it("signale les références externes sans échouer", () => {
    const spec = base({
      paths: { "/a": { get: { responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "autre.yaml#/Pet" } } } } } } } },
    });
    const r = run(spec);
    expect(r.warnings.join(" ")).toContain("autre.yaml#/Pet");
    expect((r.value.items[0] as RequestItem).tests).toEqual([{ type: "status", expected: 200 }]); // schéma vide : pas d'assertion
  });

  it("ignore les chemins invalides et signale une spécification sans opération", () => {
    const r = run(base({ paths: { "sans-slash": { get: { responses: {} } }, "x-ext": {} } }));
    expect(r.warnings.join(" ")).toContain("sans-slash");
    expect(r.warnings.join(" ")).toContain("Aucune opération");
    expect(r.value.items).toEqual([]);
  });
});

describe("entrées invalides et limites", () => {
  it("refuse Swagger 2.0 avec un message clair", () => {
    expect(() => importOpenApi({ swagger: "2.0", info: {}, paths: {} })).toThrow(/Swagger 2\.0 n'est pas supporté/);
  });

  it("refuse ce qui n'est pas une spécification OpenAPI 3", () => {
    expect(() => importOpenApi("texte")).toThrow(CollectionError);
    expect(() => importOpenApi({ info: {}, paths: {} })).toThrow(/OpenAPI 3/);
    expect(() => importOpenApi({ openapi: "3.0.0", info: {} })).toThrow(/paths/);
  });

  it("refuse trop d'opérations", () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 5001; i++) paths[`/p${i}`] = { get: { responses: {} } };
    expect(() => importOpenApi({ openapi: "3.0.0", info: { title: "T", version: "1" }, servers: [{ url: "http://x" }], paths })).toThrow(/Trop d'opérations/);
  });

  it("avertit quand aucun serveur n'est déclaré ou que son URL est relative", () => {
    const spec = { openapi: "3.0.0", info: { title: "T", version: "1" }, paths: {} };
    expect(run(spec).warnings.join(" ")).toContain("Aucun serveur");
    expect(run({ ...spec, servers: [{ url: "/api/v3" }] }).warnings.join(" ")).toContain("n'est pas absolue");
  });
});