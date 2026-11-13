import { parseJsonPath } from "@/shared/jsonpath";
import type { Assertion, Auth, Collection, CollectionItem, Environment, Extractor, HttpRequest, Scripts } from "@/shared/schemas";
import { Warnings } from "./warnings";

const POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

type Json = Record<string, unknown>;

const param = (key: string, value: string) => ({ key, value, type: "string" });

function exportAuth(auth: Auth): Json {
  switch (auth.type) {
    case "none":
      return { type: "noauth" };
    case "basic":
      return { type: "basic", basic: [param("username", auth.username), param("password", auth.password)] };
    case "bearer":
      return { type: "bearer", bearer: [param("token", auth.token)] };
    case "apiKey":
      return { type: "apikey", apikey: [param("key", auth.key), param("value", auth.value), param("in", auth.in)] };
  }
}

function exportBody(body: HttpRequest["body"], where: string, warnings: Warnings): Json | undefined {
  switch (body.type) {
    case "none":
      return undefined;
    case "json":
      return { mode: "raw", raw: body.content, options: { raw: { language: "json" } } };
    case "xml":
      return { mode: "raw", raw: body.content, options: { raw: { language: "xml" } } };
    case "raw": {
      const language = body.contentType.includes("html") ? "html" : body.contentType.includes("javascript") ? "javascript" : "text";
      return { mode: "raw", raw: body.content, options: { raw: { language } } };
    }
    case "urlencoded":
      return {
        mode: "urlencoded",
        urlencoded: body.fields.map((f) => ({ key: f.key, value: f.value, ...(f.enabled ? {} : { disabled: true }) })),
      };
    case "form-data": {
      const formdata: Json[] = [];
      for (const f of body.fields) {
        if (f.kind === "file") {
          warnings.add(`${where} : champ fichier « ${f.key} » non exporté (le contenu binaire n'est pas inclus dans une collection Postman).`);
          continue;
        }
        formdata.push({ key: f.key, value: f.value, type: "text", ...(f.enabled ? {} : { disabled: true }) });
      }
      return formdata.length > 0 ? { mode: "formdata", formdata } : undefined;
    }
    case "binary":
      warnings.add(`${where} : body binaire non exporté.`);
      return undefined;
  }
}

// --- Traduction des assertions et extractions en script Postman --------------------------------------------------

/** json?.["a"]?.["b"]?.[0] ; null si le chemin utilise un joker (non traduisible en accès direct). */
function accessor(path: string): string | null {
  let segments;
  try {
    segments = parseJsonPath(path);
  } catch {
    return null;
  }
  let expr = "json";
  for (const s of segments) {
    if (s.type === "wildcard") return null;
    if (s.type === "key") expr += `?.[${JSON.stringify(s.key)}]`;
    else expr += s.index >= 0 ? `?.[${s.index}]` : `?.slice(${s.index})?.[0]`;
  }
  return expr;
}

/** Les {{variables}} d'un texte sont résolues par Postman au moment de l'exécution. */
const literal = (value: string): string =>
  value.includes("{{") ? `pm.variables.replaceIn(${JSON.stringify(value)})` : JSON.stringify(value);

const valueExpr = (value: string | number | boolean | null | undefined): string =>
  typeof value === "string" ? literal(value) : JSON.stringify(value ?? "");

const COMPARISONS = { lt: "below", lte: "at.most", gt: "above", gte: "at.least" } as const;

function assertionLabel(a: Assertion): string {
  if (a.label) return a.label;
  switch (a.type) {
    case "status":
      return Array.isArray(a.expected) ? `Statut dans [${a.expected.join(", ")}]` : `Statut ${a.expected}`;
    case "responseTime":
      return `Temps de réponse ${a.operator} ${a.valueMs} ms`;
    case "header":
      return `Header ${a.headerName} ${a.operator}`;
    case "jsonPath":
      return `${a.path} ${a.operator}`;
    case "bodyContains":
      return `Body contient « ${a.value} »`;
    case "jsonSchema":
      return "Body conforme au schéma";
  }
}

/** Instruction Postman équivalente, ou null si l'assertion n'est pas traduisible. */
function assertionStatement(a: Assertion): string | null {
  switch (a.type) {
    case "status":
      return Array.isArray(a.expected)
        ? `pm.expect(${JSON.stringify(a.expected)}).to.include(pm.response.code);`
        : `pm.response.to.have.status(${a.expected});`;
    case "responseTime":
      return `pm.expect(pm.response.responseTime).to.be.${COMPARISONS[a.operator]}(${a.valueMs});`;
    case "bodyContains":
      return `pm.expect(pm.response.text()).to.include(${literal(a.value)});`;
    case "header": {
      const name = JSON.stringify(a.headerName);
      const value = literal(a.value ?? "");
      switch (a.operator) {
        case "exists":
          return `pm.response.to.have.header(${name});`;
        case "notExists":
          return `pm.expect(pm.response.headers.has(${name})).to.be.false;`;
        case "equals":
          return `pm.expect(pm.response.headers.get(${name})).to.eql(${value});`;
        case "contains":
          return `pm.expect(String(pm.response.headers.get(${name}))).to.include(${value});`;
        case "matches":
          return `pm.expect(String(pm.response.headers.get(${name}))).to.match(new RegExp(${value}));`;
      }
      return null;
    }
    case "jsonPath": {
      const acc = accessor(a.path);
      if (acc === null) return null;
      const value = valueExpr(a.value);
      switch (a.operator) {
        case "exists":
          return `pm.expect(${acc}).to.not.be.undefined;`;
        case "notExists":
          return `pm.expect(${acc}).to.be.undefined;`;
        case "equals":
          return `pm.expect(String(${acc})).to.eql(String(${value}));`;
        case "notEquals":
          return `pm.expect(String(${acc})).to.not.eql(String(${value}));`;
        case "contains":
          return `pm.expect(${acc}).to.include(${value});`;
        case "matches":
          return `pm.expect(String(${acc})).to.match(new RegExp(String(${value})));`;
        case "gt":
        case "gte":
        case "lt":
        case "lte":
          return `pm.expect(Number(${acc})).to.be.${COMPARISONS[a.operator]}(Number(${value}));`;
        case "type": {
          if (a.value === "array") return `pm.expect(Array.isArray(${acc})).to.be.true;`;
          if (a.value === "null") return `pm.expect(${acc}).to.be.null;`;
          return `pm.expect(typeof ${acc}).to.eql(${JSON.stringify(a.value)});`;
        }
      }
      return null;
    }
    case "jsonSchema":
      return null;
  }
}

function extractionLines(e: Extractor): string[] | null {
  const name = JSON.stringify(e.variable);
  switch (e.from) {
    case "status":
      return [`pm.collectionVariables.set(${name}, String(pm.response.code));`];
    case "header":
      return [
        "{",
        `    const h = pm.response.headers.get(${JSON.stringify(e.headerName)});`,
        `    if (h !== undefined) { pm.collectionVariables.set(${name}, h); }`,
        "}",
      ];
    case "regex":
      return [
        "{",
        `    const m = new RegExp(${JSON.stringify(e.pattern)}).exec(pm.response.text());`,
        `    if (m && m[${e.group}] !== undefined) { pm.collectionVariables.set(${name}, m[${e.group}]); }`,
        "}",
      ];
    case "jsonPath": {
      const acc = accessor(e.path);
      if (acc === null) return null;
      return [
        "{",
        `    const v = ${acc};`,
        `    if (v !== undefined) { pm.collectionVariables.set(${name}, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)); }`,
        "}",
      ];
    }
  }
}

/** Script de test Postman : assertions et extractions déclaratives, puis le script d'origine s'il y en a un. */
function buildTestScript(
  tests: Assertion[],
  extract: Extractor[],
  original: string | undefined,
  where: string,
  warnings: Warnings,
): string[] {
  const body: string[] = [];

  for (const a of tests) {
    const statement = assertionStatement(a);
    const label = assertionLabel(a);
    if (statement === null) {
      body.push(`// Assertion non convertie : ${label}`);
      warnings.add(`${where} : l'assertion « ${label} » (${a.type}) n'a pas d'équivalent Postman direct, elle n'est pas exportée.`);
      continue;
    }
    body.push(`pm.test(${JSON.stringify(label)}, function () {`, `    ${statement}`, "});");
  }
  for (const e of extract) {
    const lines = extractionLines(e);
    if (lines === null) {
      body.push(`// Extraction non convertie : ${e.variable}`);
      warnings.add(`${where} : l'extraction « ${e.variable} » (chemin avec joker) n'est pas exportée.`);
      continue;
    }
    body.push(...lines);
  }

  const lines: string[] = [];
  if (body.length > 0) {
    lines.push("// Généré par API Engineering Platform à partir des assertions et extractions déclaratives.");
    if ([...tests, ...extract].some((x) => ("path" in x ? accessor(x.path) !== null : false))) {
      lines.push("const json = (function () { try { return pm.response.json(); } catch (e) { return undefined; } })();");
    }
    lines.push(...body);
  }
  if (original) lines.push(...original.split("\n"));
  return lines;
}

const event = (listen: "prerequest" | "test", lines: string[]): Json => ({
  listen,
  script: { type: "text/javascript", exec: lines },
});

function scriptEvents(scripts: Scripts | undefined, testLines: string[]): Json[] {
  const events: Json[] = [];
  if (scripts?.preRequest) events.push(event("prerequest", scripts.preRequest.split("\n")));
  if (testLines.length > 0) events.push(event("test", testLines));
  return events;
}

function exportItem(item: CollectionItem, warnings: Warnings): Json {
  if (item.type === "folder") {
    const out: Json = { name: item.name, item: item.items.map((child) => exportItem(child, warnings)) };
    if (item.description) out.description = item.description;
    if (item.auth) out.auth = exportAuth(item.auth);
    const events = scriptEvents(item.scripts, item.scripts?.test ? item.scripts.test.split("\n") : []);
    if (events.length > 0) out.event = events;
    return out;
  }

  const where = `« ${item.name} »`;
  const r = item.request;
  const enabledParams = r.params.filter((p) => p.enabled);
  const raw = r.url + (enabledParams.length > 0 ? `?${enabledParams.map((p) => `${p.key}=${p.value}`).join("&")}` : "");

  const request: Json = {
    method: r.method,
    header: r.headers.map((h) => ({ key: h.key, value: h.value, ...(h.enabled ? {} : { disabled: true }) })),
    url: {
      raw,
      ...(r.params.length > 0
        ? { query: r.params.map((p) => ({ key: p.key, value: p.value, ...(p.enabled ? {} : { disabled: true }) })) }
        : {}),
    },
  };
  const body = exportBody(r.body, where, warnings);
  if (body) request.body = body;
  if (item.authMode === "own") request.auth = exportAuth(r.auth);

  const out: Json = { name: item.name, request };
  if (item.id) out.id = item.id;
  if (item.description) request.description = item.description;
  if (!r.followRedirects) out.protocolProfileBehavior = { followRedirects: false };

  const testLines = buildTestScript(item.tests, item.extract, item.scripts?.test, where, warnings);
  const events = scriptEvents(item.scripts, testLines);
  if (events.length > 0) out.event = events;
  return out;
}

export interface PostmanExport {
  collection: Json;
  warnings: string[];
}

/** Exporte une collection au format Postman v2.1. */
export function exportPostmanCollection(collection: Collection): PostmanExport {
  const warnings = new Warnings();

  for (const v of collection.variables) {
    if (v.secret) warnings.add(`Variable « ${v.key} » : le caractère secret n'est pas conservé dans une collection Postman.`);
  }

  const out: Json = {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      ...(collection.description ? { description: collection.description } : {}),
      schema: POSTMAN_SCHEMA,
    },
    item: collection.items.map((item) => exportItem(item, warnings)),
  };
  if (collection.variables.length > 0) {
    out.variable = collection.variables.map((v) => ({ key: v.key, value: v.value, ...(v.enabled ? {} : { disabled: true }) }));
  }
  if (collection.auth) out.auth = exportAuth(collection.auth);
  const events = scriptEvents(collection.scripts, collection.scripts?.test ? collection.scripts.test.split("\n") : []);
  if (events.length > 0) out.event = events;

  return { collection: out, warnings: warnings.toArray() };
}

/** Exporte un environnement au format Postman. */
export function exportPostmanEnvironment(environment: Environment): Json {
  return {
    id: environment.id,
    name: environment.name,
    values: environment.variables.map((v) => ({
      key: v.key,
      value: v.value,
      type: v.secret ? "secret" : "default",
      enabled: v.enabled,
    })),
    _postman_variable_scope: "environment",
    _postman_exported_using: "ApiEngineeringPlatform",
  };
}