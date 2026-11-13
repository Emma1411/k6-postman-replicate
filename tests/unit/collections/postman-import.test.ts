import { describe, expect, it } from "vitest";
import { importPostmanCollection, importPostmanEnvironment } from "@/shared/collections/postman-import";
import { CollectionError, type FolderItem, type RequestItem } from "@/shared/schemas";
import { V21, basicAuth, col, ids, req } from "../../helpers/postman-fixtures";

const run = (item: unknown[], extra: Record<string, unknown> = {}) => importPostmanCollection(col(item, extra), { idFactory: ids() });
const first = (result: ReturnType<typeof run>) => result.value.items[0] as RequestItem;
const requestOf = (item: Record<string, unknown>, extra: Record<string, unknown> = {}) => first(run([req("R", item, extra)]));

describe("structure", () => {
  it("importe l'arborescence, les variables, l'authentification et les scripts", () => {
    const result = run(
      [
        { name: "Utilisateurs", id: "dossier-1", auth: basicAuth, item: [req("Créer", { method: "POST", url: "{{base}}/users" }, { id: "req-1" })] },
        req("Santé", { method: "GET", url: "{{base}}/health" }),
      ],
      {
        info: {
          _postman_id: "11111111-1111-4111-8111-111111111111",
          name: "Boutique",
          description: { content: "API de démo", type: "text/plain" },
          schema: V21,
        },
        auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
        variable: [
          { key: "base", value: "http://localhost:3000" },
          { key: "token", value: "abc", type: "secret" },
          { key: "mauvais nom", value: "x" },
        ],
        event: [{ listen: "prerequest", script: { exec: ["console.log('a');", "console.log('b');"] } }],
      },
    );
    const c = result.value;

    expect(c.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(c.name).toBe("Boutique");
    expect(c.description).toBe("API de démo");
    expect(c.variables).toEqual([
      { key: "base", value: "http://localhost:3000", enabled: true, secret: false },
      { key: "token", value: "abc", enabled: true, secret: true },
    ]);
    expect(result.warnings.join(" ")).toContain("mauvais nom");
    expect(c.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(c.scripts?.preRequest).toBe("console.log('a');\nconsole.log('b');");

    const folder = c.items[0] as FolderItem;
    expect(folder.type).toBe("folder");
    expect(folder.id).toBe("dossier-1");
    expect(folder.auth).toEqual({ type: "basic", username: "u", password: "p" });
    const nested = folder.items[0] as RequestItem;
    expect(nested.id).toBe("req-1");
    expect(nested.authMode).toBe("inherit");
    expect((c.items[1] as RequestItem).authMode).toBe("inherit");
    expect(result.stats).toEqual({ requests: 2, folders: 1, skipped: 0 });
  });

  it("attribue des identifiants propres quand ceux de Postman manquent ou se répètent", () => {
    const result = run([
      req("A", { method: "GET", url: "http://x/a" }, { id: "dup" }),
      req("B", { method: "GET", url: "http://x/b" }, { id: "dup" }),
      req("C", { method: "GET", url: "http://x/c" }, { id: "id invalide !" }),
      req("D", { method: "GET", url: "http://x/d" }),
    ]);
    const all = result.value.items.map((i) => i.id);
    expect(new Set(all).size).toBe(4);
    expect(all[0]).toBe("dup");
    expect(all.slice(1)).toEqual(["id2", "id3", "id4"]); // id1 est pris par la collection
  });

  it("déplace les variables de dossier sans écraser celles de la collection", () => {
    const result = run(
      [{ name: "D", variable: [{ key: "base", value: "dossier" }, { key: "local", value: "1" }], item: [] }],
      { variable: [{ key: "base", value: "collection" }] },
    );
    expect(result.value.variables).toEqual([
      { key: "base", value: "collection", enabled: true, secret: false },
      { key: "local", value: "1", enabled: true, secret: false },
    ]);
    expect(result.warnings.join(" ")).toContain("déplacée au niveau de la collection");
  });
});

describe("URL et paramètres", () => {
  it("sépare la query de l'URL et décode les paramètres", () => {
    const r = requestOf({ method: "GET", url: "{{base}}/items?limit=10&name=a%20b&flag#ancre" }).request;
    expect(r.url).toBe("{{base}}/items");
    expect(r.params).toEqual([
      { key: "limit", value: "10", enabled: true },
      { key: "name", value: "a b", enabled: true },
      { key: "flag", value: "", enabled: true },
    ]);
  });

  it("préfère le tableau `query` d'une URL objet, avec ses paramètres désactivés", () => {
    const r = requestOf({
      method: "GET",
      url: {
        raw: "{{base}}/items?limit=10",
        query: [{ key: "limit", value: "10" }, { key: "debug", value: "1", disabled: true }, { key: null, value: "x" }],
      },
    }).request;
    expect(r.url).toBe("{{base}}/items");
    expect(r.params).toEqual([
      { key: "limit", value: "10", enabled: true },
      { key: "debug", value: "1", enabled: false },
    ]);
  });

  it("reconstruit l'URL depuis ses morceaux quand `raw` manque", () => {
    const r = requestOf({ method: "GET", url: { protocol: "https", host: ["api", "exemple", "com"], port: "8443", path: ["v1", "items"] } }).request;
    expect(r.url).toBe("https://api.exemple.com:8443/v1/items");
  });

  it("remplace les variables de chemin et signale celles sans valeur", () => {
    const result = run([
      req("Chemin", {
        method: "GET",
        url: { raw: "{{base}}/users/:id/posts/:postId", variable: [{ key: "id", value: "7" }] },
      }),
    ]);
    expect(first(result).request.url).toBe("{{base}}/users/7/posts/:postId");
    expect(result.warnings.join(" ")).toContain(":postId");
  });

  it("accepte une requête donnée comme simple chaîne d'URL", () => {
    const item = first(run([{ name: "Brute", request: "https://exemple.com/x" }]));
    expect(item.request.method).toBe("GET");
    expect(item.request.url).toBe("https://exemple.com/x");
  });
});

describe("headers", () => {
  it("conserve les headers désactivés et retire ceux gérés par l'envoi ou invalides", () => {
    const result = run([
      req("H", {
        method: "GET",
        url: "http://x",
        header: [
          { key: "Accept", value: "application/json" },
          { key: "X-Off", value: "1", disabled: true },
          { key: "Content-Length", value: "5" },
          { key: "mauvais nom", value: "x" },
          { key: "X-Injecte", value: "a\r\nb" },
        ],
      }),
    ]);
    expect(first(result).request.headers).toEqual([
      { key: "Accept", value: "application/json", enabled: true },
      { key: "X-Off", value: "1", enabled: false },
    ]);
    const warnings = result.warnings.join(" ");
    expect(warnings).toContain("Content-Length");
    expect(warnings).toContain("mauvais nom");
    expect(warnings).toContain("X-Injecte");
  });
});

describe("bodies", () => {
  const body = (b: unknown, method = "POST") => run([req("B", { method, url: "http://x", body: b })]);

  it("convertit les bodies bruts selon leur langage", () => {
    const type = (language?: string) =>
      first(body({ mode: "raw", raw: "contenu", options: language ? { raw: { language } } : {} })).request.body;
    expect(type("json")).toEqual({ type: "json", content: "contenu" });
    expect(type("xml")).toEqual({ type: "xml", content: "contenu" });
    expect(type("html")).toEqual({ type: "raw", content: "contenu", contentType: "text/html" });
    expect(type("javascript")).toEqual({ type: "raw", content: "contenu", contentType: "application/javascript" });
    expect(type()).toEqual({ type: "raw", content: "contenu", contentType: "text/plain" });
  });

  it("convertit urlencoded et form-data, et signale les champs fichier", () => {
    const urlencoded = first(body({ mode: "urlencoded", urlencoded: [{ key: "a", value: "1" }, { key: "b", value: "2", disabled: true }] }));
    expect(urlencoded.request.body).toEqual({
      type: "urlencoded",
      fields: [{ key: "a", value: "1", enabled: true }, { key: "b", value: "2", enabled: false }],
    });

    const result = body({
      mode: "formdata",
      formdata: [{ key: "nom", value: "emma", type: "text" }, { key: "photo", type: "file", src: "/tmp/p.png" }],
    });
    expect(first(result).request.body).toEqual({ type: "form-data", fields: [{ kind: "text", key: "nom", value: "emma", enabled: true }] });
    expect(result.warnings.join(" ")).toContain("photo");
  });

  it("convertit GraphQL en body JSON", () => {
    const r = first(body({ mode: "graphql", graphql: { query: "{ me { id } }", variables: '{"id":7}' } })).request.body;
    expect(r.type).toBe("json");
    expect(JSON.parse((r as { content: string }).content)).toEqual({ query: "{ me { id } }", variables: { id: 7 } });
  });

  it("ignore un body désactivé, vide, binaire ou de type inconnu", () => {
    expect(first(body({ mode: "raw", raw: "x", disabled: true })).request.body).toEqual({ type: "none" });
    expect(first(body({ mode: "raw", raw: "" })).request.body).toEqual({ type: "none" });
    expect(body({ mode: "file", file: { src: "x" } }).warnings.join(" ")).toContain("binaire");
    expect(body({ mode: "inconnu" }).warnings.join(" ")).toContain("inconnu");
  });

  it("retire le body d'une requête GET en le signalant", () => {
    const result = body({ mode: "raw", raw: "{}", options: { raw: { language: "json" } } }, "GET");
    expect(first(result).request.body).toEqual({ type: "none" });
    expect(result.warnings.join(" ")).toContain("GET");
  });
});

describe("authentification", () => {
  const auth = (a: unknown) => run([req("A", { method: "GET", url: "http://x", auth: a })]);

  it("convertit les types supportés", () => {
    expect(first(auth({ type: "noauth" })).request.auth).toEqual({ type: "none" });
    expect(first(auth({ type: "noauth" })).authMode).toBe("own");
    expect(first(auth(basicAuth)).request.auth).toEqual({ type: "basic", username: "u", password: "p" });
    expect(first(auth({ type: "apikey", apikey: [{ key: "key", value: "X-Key" }, { key: "value", value: "k" }, { key: "in", value: "query" }] })).request.auth)
      .toEqual({ type: "apiKey", key: "X-Key", value: "k", in: "query" });
  });

  it("accepte le style objet de Postman v2.0", () => {
    expect(first(auth({ type: "bearer", bearer: { token: "abc" } })).request.auth).toEqual({ type: "bearer", token: "abc" });
  });

  it("convertit OAuth 2.0 en jeton fixe quand un jeton est présent", () => {
    const result = auth({ type: "oauth2", oauth2: [{ key: "accessToken", value: "tok" }, { key: "addTokenTo", value: "header" }] });
    expect(first(result).request.auth).toEqual({ type: "bearer", token: "tok" });
    expect(result.warnings.join(" ")).toContain("renouvelé");
  });

  it("n'applique aucune authentification quand elle n'est pas supportée, et le dit", () => {
    for (const a of [{ type: "digest", digest: [] }, { type: "oauth2", oauth2: [] }, { type: "apikey", apikey: [] }]) {
      const result = auth(a);
      expect(first(result).authMode).toBe("own");
      expect(first(result).request.auth).toEqual({ type: "none" });
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("traite « inherit » comme l'absence d'authentification", () => {
    expect(first(auth({ type: "inherit" })).authMode).toBe("inherit");
  });
});

describe("requêtes particulières", () => {
  it("ignore une méthode non supportée et le compte", () => {
    const result = run([req("Copie", { method: "COPY", url: "http://x" }), req("OK", { method: "GET", url: "http://x" })]);
    expect(result.value.items).toHaveLength(1);
    expect(result.stats).toMatchObject({ requests: 1, skipped: 1 });
    expect(result.warnings.join(" ")).toContain("COPY");
  });

  it("lit followRedirects et conserve les scripts de la requête", () => {
    const item = first(
      run([
        req("S", { method: "GET", url: "http://x" }, {
          protocolProfileBehavior: { followRedirects: false },
          event: [
            { listen: "prerequest", script: { exec: ["a();"] } },
            { listen: "test", script: { exec: ["pm.test('ok', () => {});"] } },
          ],
        }),
      ]),
    );
    expect(item.request.followRedirects).toBe(false);
    expect(item.scripts).toEqual({ preRequest: "a();", test: "pm.test('ok', () => {});" });
  });

  it("ignore un élément sans requête", () => {
    const result = run([{ name: "Vide" }]);
    expect(result.value.items).toEqual([]);
    expect(result.stats.skipped).toBe(1);
  });
});

describe("entrées invalides et limites", () => {
  it("refuse ce qui n'est pas une collection Postman", () => {
    expect(() => importPostmanCollection({})).toThrow(CollectionError);
    expect(() => importPostmanCollection([])).toThrow(/collection Postman/);
    expect(() => importPostmanCollection({ info: { name: "x" } })).toThrow(/collection Postman/);
  });

  it("refuse une version non supportée", () => {
    const old = { info: { name: "x", schema: "https://schema.getpostman.com/json/collection/v1.0.0/collection.json" }, item: [] };
    expect(() => importPostmanCollection(old)).toThrow(/Version de collection non supportée/);
  });

  it("refuse des dossiers trop imbriqués", () => {
    let node: Record<string, unknown> = req("Feuille", { method: "GET", url: "http://x" });
    for (let i = 0; i < 21; i++) node = { name: `D${i}`, item: [node] };
    expect(() => run([node])).toThrow(/imbriqués/);
  });

  it("refuse trop de requêtes", () => {
    const many = Array.from({ length: 5001 }, (_, i) => req(`R${i}`, { method: "GET", url: "http://x" }));
    expect(() => importPostmanCollection(col(many))).toThrow(/Trop de requêtes/);
  });

  it("plafonne et dédoublonne les avertissements", () => {
    const items = Array.from({ length: 300 }, (_, i) => req(`R${i}`, { method: "COPY", url: "http://x" }));
    const { warnings } = run(items);
    expect(warnings).toHaveLength(201);
    expect(warnings.at(-1)).toContain("100 autre(s)");
  });
});

describe("environnements", () => {
  it("importe les variables, leur état et leur caractère secret", () => {
    const { value, warnings } = importPostmanEnvironment(
      {
        id: "env-1",
        name: "Production",
        values: [
          { key: "base", value: "https://api.exemple.com", enabled: true },
          { key: "token", value: "s3cret", type: "secret", enabled: true },
          { key: "off", value: "1", enabled: false },
          { key: "mauvais nom", value: "x" },
        ],
      },
      { idFactory: ids() },
    );
    expect(value.id).toBe("env-1");
    expect(value.name).toBe("Production");
    expect(value.variables).toEqual([
      { key: "base", value: "https://api.exemple.com", enabled: true, secret: false },
      { key: "token", value: "s3cret", enabled: true, secret: true },
      { key: "off", value: "1", enabled: false, secret: false },
    ]);
    expect(warnings.join(" ")).toContain("mauvais nom");
  });

  it("refuse un JSON qui n'est pas un environnement", () => {
    expect(() => importPostmanEnvironment({ info: {} })).toThrow(/environnement Postman/);
  });
});