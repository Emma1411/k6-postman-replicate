import { describe, expect, it } from "vitest";
import { exportPostmanCollection, exportPostmanEnvironment } from "@/shared/collections/postman-export";
import { importPostmanCollection, importPostmanEnvironment } from "@/shared/collections/postman-import";
import { COLLECTION_FORMAT, ENVIRONMENT_FORMAT, parseCollection, parseEnvironment, type FolderItem, type RequestItem } from "@/shared/schemas";

const collection = () =>
  parseCollection({
    format: COLLECTION_FORMAT,
    version: 1,
    id: "col-1",
    name: "Boutique",
    description: "démo",
    variables: [
      { key: "base", value: "http://localhost:3000", enabled: true },
      { key: "token", value: "t", enabled: false, secret: true },
    ],
    auth: { type: "bearer", token: "{{token}}" },
    scripts: { preRequest: "console.log(1)" },
    items: [
      {
        type: "folder",
        id: "f1",
        name: "Utilisateurs",
        auth: { type: "basic", username: "u", password: "p" },
        items: [
          {
            type: "request",
            id: "r1",
            name: "Créer",
            authMode: "inherit",
            request: {
              method: "POST",
              url: "{{base}}/users",
              params: [{ key: "a", value: "1" }, { key: "b", value: "2", enabled: false }],
              headers: [{ key: "X-A", value: "1" }, { key: "X-B", value: "2", enabled: false }],
              body: { type: "json", content: '{"name":"x"}' },
              followRedirects: false,
            },
            tests: [
              { type: "status", expected: 201 },
              { type: "jsonPath", path: "$.id", operator: "type", value: "number" },
              { type: "jsonPath", path: "$.name", operator: "equals", value: "{{nom}}" },
              { type: "header", headerName: "Content-Type", operator: "exists" },
              { type: "responseTime", operator: "lt", valueMs: 500 },
              { type: "jsonSchema", schema: { type: "object" } },
              { type: "jsonPath", path: "$.items[*].id", operator: "exists" },
            ],
            extract: [
              { variable: "userId", from: "jsonPath", path: "$.id" },
              { variable: "loc", from: "header", headerName: "Location" },
            ],
            scripts: { test: "console.log('perso');" },
          },
        ],
      },
      {
        type: "request",
        id: "r2",
        name: "Santé",
        authMode: "own",
        request: { method: "GET", url: "{{base}}/health", auth: { type: "apiKey", key: "X-Key", value: "k", in: "query" } },
      },
    ],
  });

type Json = Record<string, any>;
const exported = () => exportPostmanCollection(collection());

describe("exportPostmanCollection", () => {
  it("écrit l'en-tête, les variables, l'authentification et les scripts de la collection", () => {
    const { collection: pm, warnings } = exported();
    expect((pm.info as Json)._postman_id).toBe("col-1");
    expect((pm.info as Json).schema).toContain("v2.1.0");
    expect(pm.variable).toEqual([{ key: "base", value: "http://localhost:3000" }, { key: "token", value: "t", disabled: true }]);
    expect(pm.auth).toEqual({ type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] });
    expect((pm.event as Json[])[0]).toMatchObject({ listen: "prerequest", script: { exec: ["console.log(1)"] } });
    expect(warnings.join(" ")).toContain("caractère secret");
  });

  it("exporte l'arborescence, la requête et l'héritage d'authentification", () => {
    const pm = exported().collection;
    const folder = (pm.item as Json[])[0];
    expect(folder.name).toBe("Utilisateurs");
    expect(folder.auth).toEqual({ type: "basic", basic: [{ key: "username", value: "u", type: "string" }, { key: "password", value: "p", type: "string" }] });

    const create = folder.item[0];
    expect(create.request.method).toBe("POST");
    expect(create.request.header).toEqual([{ key: "X-A", value: "1" }, { key: "X-B", value: "2", disabled: true }]);
    expect(create.request.url.raw).toBe("{{base}}/users?a=1");
    expect(create.request.url.query).toEqual([{ key: "a", value: "1" }, { key: "b", value: "2", disabled: true }]);
    expect(create.request.body).toEqual({ mode: "raw", raw: '{"name":"x"}', options: { raw: { language: "json" } } });
    expect(create.request.auth).toBeUndefined(); // hérite
    expect(create.protocolProfileBehavior).toEqual({ followRedirects: false });

    const health = (pm.item as Json[])[1];
    expect(health.request.auth).toEqual({
      type: "apikey",
      apikey: [{ key: "key", value: "X-Key", type: "string" }, { key: "value", value: "k", type: "string" }, { key: "in", value: "query", type: "string" }],
    });
  });

  it("traduit les assertions et extractions en script Postman, puis ajoute le script d'origine", () => {
    const create = ((exported().collection.item as Json[])[0].item as Json[])[0];
    const script = (create.event as Json[]).find((e) => e.listen === "test")!.script.exec.join("\n");

    expect(script).toContain("const json = (function ()");
    expect(script).toContain("pm.response.to.have.status(201);");
    expect(script).toContain('pm.expect(typeof json?.["id"]).to.eql("number");');
    expect(script).toContain('pm.expect(String(json?.["name"])).to.eql(String(pm.variables.replaceIn("{{nom}}")));');
    expect(script).toContain('pm.response.to.have.header("Content-Type");');
    expect(script).toContain("pm.expect(pm.response.responseTime).to.be.below(500);");
    expect(script).toContain('pm.collectionVariables.set("userId"');
    expect(script).toContain('pm.response.headers.get("Location")');
    expect(script.endsWith("console.log('perso');")).toBe(true);
  });

  it("signale ce qui n'a pas d'équivalent Postman", () => {
    const { collection: pm, warnings } = exported();
    const script = (((pm.item as Json[])[0].item as Json[])[0].event as Json[]).find((e) => e.listen === "test")!.script.exec.join("\n");
    expect(script).toContain("// Assertion non convertie : Body conforme au schéma");
    expect(script).toContain("// Assertion non convertie : $.items[*].id exists");
    expect(warnings.join(" ")).toContain("jsonSchema");
    expect(warnings.join(" ")).toContain("$.items[*].id");
  });

  it("n'exporte pas les champs binaires et le fait savoir", () => {
    const c = parseCollection({
      format: COLLECTION_FORMAT,
      version: 1,
      id: "c",
      name: "C",
      items: [
        {
          type: "request",
          id: "r",
          name: "Upload",
          request: {
            method: "POST",
            url: "http://x",
            body: {
              type: "form-data",
              fields: [{ kind: "text", key: "nom", value: "e" }, { kind: "file", key: "photo", filename: "p.png", base64: "AAAA" }],
            },
          },
        },
      ],
    });
    const { collection: pm, warnings } = exportPostmanCollection(c);
    const body = ((pm.item as Json[])[0].request as Json).body;
    expect(body.formdata).toEqual([{ key: "nom", value: "e", type: "text" }]);
    expect(warnings.join(" ")).toContain("photo");
  });
});

describe("aller-retour Postman", () => {
  it("préserve l'essentiel d'une collection exportée puis réimportée", () => {
    const original = collection();
    const reimported = importPostmanCollection(exportPostmanCollection(original).collection).value;

    expect(reimported.id).toBe("col-1");
    expect(reimported.name).toBe("Boutique");
    expect(reimported.variables.map((v) => [v.key, v.value, v.enabled])).toEqual([
      ["base", "http://localhost:3000", true],
      ["token", "t", false],
    ]);
    expect(reimported.auth).toEqual({ type: "bearer", token: "{{token}}" });

    const folder = reimported.items[0] as FolderItem;
    expect(folder.auth).toEqual({ type: "basic", username: "u", password: "p" });
    const create = folder.items[0] as RequestItem;
    expect(create.authMode).toBe("inherit");
    expect(create.request).toMatchObject({
      method: "POST",
      url: "{{base}}/users",
      params: [{ key: "a", value: "1", enabled: true }, { key: "b", value: "2", enabled: false }],
      headers: [{ key: "X-A", value: "1", enabled: true }, { key: "X-B", value: "2", enabled: false }],
      body: { type: "json", content: '{"name":"x"}' },
      followRedirects: false,
    });
    expect(create.scripts?.test).toContain("console.log('perso');");
    expect(create.scripts?.test).toContain("pm.response.to.have.status(201);");

    const health = reimported.items[1] as RequestItem;
    expect(health.authMode).toBe("own");
    expect(health.request.auth).toEqual({ type: "apiKey", key: "X-Key", value: "k", in: "query" });
  });
});

describe("environnements", () => {
  it("exporte puis réimporte un environnement sans perte", () => {
    const env = parseEnvironment({
      format: ENVIRONMENT_FORMAT,
      version: 1,
      id: "env-1",
      name: "Prod",
      variables: [{ key: "base", value: "https://api" }, { key: "token", value: "s", secret: true }, { key: "off", value: "1", enabled: false }],
    });
    const pm = exportPostmanEnvironment(env);
    expect(pm.values).toEqual([
      { key: "base", value: "https://api", type: "default", enabled: true },
      { key: "token", value: "s", type: "secret", enabled: true },
      { key: "off", value: "1", type: "default", enabled: false },
    ]);
    expect(pm._postman_variable_scope).toBe("environment");
    expect(importPostmanEnvironment(pm).value).toEqual(env);
  });
});