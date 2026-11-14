import {
  COLLECTION_FORMAT,
  COLLECTION_LIMITS,
  CollectionError,
  newId,
  parseCollection,
} from "@/shared/schemas";
import type {
  Assertion,
  Auth,
  Collection,
  CollectionItem,
  FolderItem,
  HttpMethod,
  HttpRequest,
  RequestItem,
  VariableEntry,
} from "@/shared/schemas";
import type { ImportOptions, ImportResult } from "./postman-import";
import { Warnings } from "./warnings";

type Json = Record<string, unknown>;
type KeyValue = { key: string; value: string; enabled: boolean };
type Body = HttpRequest["body"];

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch"] as const;
// L'OpenAPI demande d'ignorer ces paramètres d'en-tête : ils sont décrits ailleurs (content, security).
const IGNORED_HEADERS = new Set(["accept", "content-type", "authorization"]);
const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const SAMPLE_DEPTH = 6;
const SCHEMA_DEPTH = 8;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NO_BODY: Body = { type: "none" };

const STRING_FORMATS: Record<string, string> = {
  "date-time": "2024-01-01T00:00:00Z",
  date: "2024-01-01",
  time: "00:00:00",
  email: "user@example.com",
  uuid: "00000000-0000-4000-8000-000000000000",
  uri: "https://example.com",
  url: "https://example.com",
  hostname: "example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  byte: "c3RyaW5n",
  password: "password",
};

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

interface Ctx {
  root: Json;
  warnings: Warnings;
  makeId: () => string;
  ids: Set<string>;
  variables: Map<string, VariableEntry>;
  requests: number;
  skipped: number;
}

function newItemId(ctx: Ctx): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = ctx.makeId();
    if (ID_PATTERN.test(id) && !ctx.ids.has(id)) {
      ctx.ids.add(id);
      return id;
    }
  }
  throw new CollectionError("Impossible de générer un identifiant valide.");
}

function describe(v: unknown): string | undefined {
  const trimmed = str(v)?.trim();
  return trimmed ? trimmed.slice(0, 10_000) : undefined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Nom de variable valide : tout caractère hors lettres, chiffres, _, - et . devient « _ ». */
function sanitizeVar(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!/^[A-Za-z_]/.test(out)) out = `_${out}`;
  return out.slice(0, 128);
}

function addVariable(ctx: Ctx, key: string, value: string, secret = false): void {
  const existing = ctx.variables.get(key);
  if (!existing) ctx.variables.set(key, { key, value: value.slice(0, 16_384), enabled: true, secret });
  else if (existing.value === "" && value !== "") existing.value = value.slice(0, 16_384);
}

// --- Références ($ref) ---------------------------------------------------------------------------------------------

function pointerGet(root: unknown, pointer: string): unknown {
  let current: unknown = root;
  for (const raw of pointer.split("/")) {
    const key = safeDecode(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) current = current[Number(key)];
    else if (isRecord(current) && hasOwn(current, key)) current = current[key];
    else return undefined;
  }
  return current;
}

/** Suit les $ref locaux (#/...) ; les références externes ne sont pas supportées. */
function deref(node: unknown, ctx: Ctx): unknown {
  let current = node;
  for (let hops = 0; isRecord(current) && typeof current.$ref === "string"; hops++) {
    if (hops > 20) return undefined;
    const ref = current.$ref;
    if (!ref.startsWith("#/")) {
      ctx.warnings.add(`Référence externe non supportée : ${ref}`);
      return undefined;
    }
    current = pointerGet(ctx.root, ref.slice(2));
  }
  return current;
}

/**
 * Résout les $ref d'un schéma en suivant ceux en cours d'expansion (`stack`) : une référence circulaire
 * (Person → friends → Person) renvoie `fallback` au lieu de boucler.
 */
function withSchema<T>(node: unknown, stack: Set<string>, ctx: Ctx, fn: (schema: Json) => T, fallback: T): T {
  let current = node;
  const added: string[] = [];
  try {
    for (let hops = 0; isRecord(current) && typeof current.$ref === "string"; hops++) {
      const ref = current.$ref;
      if (hops > 20 || stack.has(ref)) return fallback;
      if (!ref.startsWith("#/")) {
        ctx.warnings.add(`Référence externe non supportée : ${ref}`);
        return fallback;
      }
      stack.add(ref);
      added.push(ref);
      current = pointerGet(ctx.root, ref.slice(2));
    }
    return isRecord(current) ? fn(current) : fallback;
  } finally {
    for (const ref of added) stack.delete(ref);
  }
}

// --- Exemples générés depuis un schéma -----------------------------------------------------------------------------

function typeOf(s: Json): string | undefined {
  const t = s.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    const first = t.find((x) => x !== "null");
    return typeof first === "string" ? first : "null";
  }
  if (isRecord(s.properties)) return "object";
  if (s.items !== undefined) return "array";
  return undefined;
}

function objectSample(s: Json, ctx: Ctx, depth: number, stack: Set<string>, forRequest: boolean): Json {
  const out: Json = {};
  const props = isRecord(s.properties) ? s.properties : {};
  for (const [key, child] of Object.entries(props)) {
    // Une propriété en lecture seule ne se renvoie pas dans une requête.
    if (forRequest && withSchema(child, new Set(), ctx, (c) => c.readOnly === true, false)) continue;
    out[key] = sample(child, ctx, depth + 1, stack, forRequest);
  }
  return out;
}

/** Valeur d'exemple : example, default, enum[0], puis une valeur type par défaut. */
function sample(node: unknown, ctx: Ctx, depth: number, stack: Set<string>, forRequest: boolean): unknown {
  if (depth > SAMPLE_DEPTH) return null;

  return withSchema(
    node,
    stack,
    ctx,
    (s): unknown => {
      if (s.example !== undefined) return s.example;
      if (s.default !== undefined) return s.default;
      if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
      if (s.const !== undefined) return s.const;

      if (Array.isArray(s.allOf)) {
        const merged: Json = {};
        for (const part of s.allOf) {
          const value = sample(part, ctx, depth + 1, stack, forRequest);
          if (isRecord(value)) Object.assign(merged, value);
        }
        if (isRecord(s.properties)) Object.assign(merged, objectSample(s, ctx, depth, stack, forRequest));
        return merged;
      }
      for (const key of ["oneOf", "anyOf"] as const) {
        const options = s[key];
        if (Array.isArray(options) && options.length > 0) return sample(options[0], ctx, depth + 1, stack, forRequest);
      }

      switch (typeOf(s)) {
        case "object":
          return objectSample(s, ctx, depth, stack, forRequest);
        case "array": {
          const items = s.items;
          if (items === undefined) return [];
          if (isRecord(items) && typeof items.$ref === "string" && stack.has(items.$ref)) return [];
          return [sample(items, ctx, depth + 1, stack, forRequest)];
        }
        case "string":
          return (typeof s.format === "string" && STRING_FORMATS[s.format]) || "string";
        case "integer":
        case "number":
          return typeof s.minimum === "number" ? s.minimum : 0;
        case "boolean":
          return false;
        default:
          return null;
      }
    },
    null,
  );
}

const stringify = (v: unknown): string =>
  typeof v === "string" ? v : Array.isArray(v) ? v.map(String).join(",") : isRecord(v) ? JSON.stringify(v) : String(v);

function xmlName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toXml(tag: string, value: unknown, depth: number): string {
  const pad = "  ".repeat(depth);
  const name = xmlName(tag);
  if (Array.isArray(value)) return value.map((v) => toXml(tag, v, depth)).join("\n");
  if (isRecord(value)) {
    const inner = Object.entries(value).map(([k, v]) => toXml(k, v, depth + 1)).join("\n");
    return `${pad}<${name}>\n${inner}\n${pad}</${name}>`;
  }
  return `${pad}<${name}>${escapeXml(value === null || value === undefined ? "" : String(value))}</${name}>`;
}

// --- Schémas réduits au sous-ensemble du moteur --------------------------------------------------------------------

function mergeSchemas(list: Json[]): Json {
  const out: Json = {};
  for (const s of list) {
    for (const [key, value] of Object.entries(s)) {
      if (key === "properties") {
        out.properties = { ...(isRecord(out.properties) ? out.properties : {}), ...(value as Json) };
      } else if (key === "required") {
        const previous = Array.isArray(out.required) ? (out.required as string[]) : [];
        out.required = [...new Set([...previous, ...(value as string[])])];
      } else if (!(key in out)) {
        out[key] = value;
      }
    }
  }
  return out;
}

function convertOwn(s: Json, ctx: Ctx, depth: number, stack: Set<string>): Json {
  const out: Json = {};

  let types: string[] = [];
  if (typeof s.type === "string") types = [s.type];
  else if (Array.isArray(s.type)) types = s.type.filter((t): t is string => typeof t === "string");
  else if (isRecord(s.properties)) types = ["object"];
  else if (s.items !== undefined) types = ["array"];
  types = types.filter((t) => SCHEMA_TYPES.has(t));
  if (s.nullable === true && types.length > 0 && !types.includes("null")) types = [...types, "null"];
  if (types.length === 1) out.type = types[0];
  else if (types.length > 1) out.type = types;

  const skipped = new Set<string>();
  if (isRecord(s.properties)) {
    const props: Json = {};
    for (const [key, child] of Object.entries(s.properties)) {
      // Une propriété en écriture seule n'apparaît jamais dans une réponse.
      if (withSchema(child, new Set(), ctx, (c) => c.writeOnly === true, false)) {
        skipped.add(key);
        continue;
      }
      props[key] = convert(child, ctx, depth + 1, stack);
    }
    out.properties = props;
  }
  if (Array.isArray(s.required)) {
    const required = s.required.filter((r): r is string => typeof r === "string" && !skipped.has(r));
    if (required.length > 0) out.required = required;
  }
  if (s.items !== undefined && !Array.isArray(s.items)) out.items = convert(s.items, ctx, depth + 1, stack);
  if (Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= 50 && s.nullable !== true) out.enum = s.enum;
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) {
    const v = s[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/**
 * Réduit un schéma OpenAPI au sous-ensemble que le moteur sait valider (type, properties, required, items,
 * enum, bornes). Les mots-clés non supportés (oneOf, pattern, format…) sont abandonnés : le schéma devient
 * moins strict, jamais plus. Les références circulaires donnent un schéma vide.
 */
function convert(node: unknown, ctx: Ctx, depth: number, stack: Set<string>): Json {
  if (depth > SCHEMA_DEPTH) return {};
  return withSchema(
    node,
    stack,
    ctx,
    (s): Json => {
      const parts = Array.isArray(s.allOf) ? s.allOf.map((p) => convert(p, ctx, depth + 1, stack)) : [];
      return mergeSchemas([convertOwn(s, ctx, depth, stack), ...parts]);
    },
    {},
  );
}

const hasConstraints = (schema: Json): boolean =>
  ["type", "properties", "items", "enum", "required"].some((key) => key in schema);

// --- Paramètres ----------------------------------------------------------------------------------------------------

/** Valeur déclarée par la spécification (example, examples, default, enum[0]) ; undefined si aucune. */
function declaredValue(param: Json, ctx: Ctx): string | undefined {
  let value: unknown = param.example;
  if (value === undefined && isRecord(param.examples)) {
    const first = deref(Object.values(param.examples)[0], ctx);
    if (isRecord(first)) value = first.value;
  }
  if (value === undefined) {
    value = withSchema(
      param.schema,
      new Set(),
      ctx,
      (s): unknown => s.example ?? s.default ?? (Array.isArray(s.enum) ? s.enum[0] : undefined),
      undefined,
    );
  }
  return value === undefined || value === null ? undefined : stringify(value);
}

/** Paramètres du chemin puis de l'opération ; l'opération remplace un paramètre de même nom et même emplacement. */
function collectParameters(pathItem: Json, op: Json, ctx: Ctx): Json[] {
  const byKey = new Map<string, Json>();
  for (const source of [pathItem.parameters, op.parameters]) {
    for (const raw of Array.isArray(source) ? source : []) {
      const p = deref(raw, ctx);
      if (isRecord(p) && typeof p.name === "string" && typeof p.in === "string") byKey.set(`${p.in}:${p.name}`, p);
    }
  }
  return [...byKey.values()];
}

function pushKeyValue(list: KeyValue[], key: string, value: string, enabled: boolean, where: string, ctx: Ctx): void {
  if (key.length > 256 || value.length > 8192) {
    ctx.warnings.add(`${where} : « ${key.slice(0, 40)} » est trop long, ignoré.`);
    return;
  }
  list.push({ key, value, enabled });
}

// --- Authentification ----------------------------------------------------------------------------------------------

type Security = { kind: "none" } | { kind: "auth"; auth: Auth } | { kind: "unsupported" };

function schemeToAuth(name: string, scheme: Json, where: string, ctx: Ctx): Auth | null {
  const base = sanitizeVar(name);
  const type = str(scheme.type);

  if (type === "http") {
    const kind = str(scheme.scheme)?.toLowerCase();
    if (kind === "basic") {
      addVariable(ctx, `${base}_username`, "");
      addVariable(ctx, `${base}_password`, "", true);
      return { type: "basic", username: `{{${base}_username}}`, password: `{{${base}_password}}` };
    }
    if (kind === "bearer") {
      addVariable(ctx, `${base}_token`, "", true);
      return { type: "bearer", token: `{{${base}_token}}` };
    }
    ctx.warnings.add(`${where} : schéma HTTP « ${kind ?? "?"} » non supporté, authentification ignorée.`);
    return null;
  }

  if (type === "apiKey") {
    const key = str(scheme.name);
    const location = str(scheme.in);
    if (!key || (location !== "header" && location !== "query")) {
      ctx.warnings.add(`${where} : clé d'API dans « ${location ?? "?"} » (schéma cookie non supporté), authentification ignorée.`);
      return null;
    }
    addVariable(ctx, `${base}_value`, "", true);
    return { type: "apiKey", key, value: `{{${base}_value}}`, in: location };
  }

  if (type === "oauth2" || type === "openIdConnect") {
    addVariable(ctx, `${base}_token`, "", true);
    ctx.warnings.add(`« ${name} » (OAuth 2.0) : obtiens un jeton, puis renseigne la variable « ${base}_token » ; il n'est pas renouvelé automatiquement.`);
    return { type: "bearer", token: `{{${base}_token}}` };
  }

  ctx.warnings.add(`${where} : schéma de sécurité « ${type ?? "?"} » non supporté, authentification ignorée.`);
  return null;
}

/** Première exigence de sécurité : « [] » ou « {} » signifie aucune authentification. */
function mapSecurity(requirements: unknown[], where: string, ctx: Ctx): Security {
  const first = requirements[0];
  if (!isRecord(first) || Object.keys(first).length === 0) return { kind: "none" };

  const names = Object.keys(first);
  if (names.length > 1) ctx.warnings.add(`${where} : plusieurs schémas combinés (${names.join(", ")}) : seul le premier est appliqué.`);

  const schemes = isRecord(ctx.root.components) && isRecord(ctx.root.components.securitySchemes) ? ctx.root.components.securitySchemes : {};
  const scheme = deref(schemes[names[0]], ctx);
  if (!isRecord(scheme)) {
    ctx.warnings.add(`${where} : schéma de sécurité « ${names[0]} » introuvable.`);
    return { kind: "unsupported" };
  }
  const auth = schemeToAuth(names[0], scheme, where, ctx);
  return auth ? { kind: "auth", auth } : { kind: "unsupported" };
}

// --- Corps de requête ----------------------------------------------------------------------------------------------

function mediaExample(media: Json, ctx: Ctx): unknown {
  if (media.example !== undefined) return media.example;
  if (isRecord(media.examples)) {
    const first = deref(Object.values(media.examples)[0], ctx);
    if (isRecord(first) && first.value !== undefined) return first.value;
  }
  return undefined;
}

function addHeader(headers: KeyValue[], key: string, value: string): void {
  if (!headers.some((h) => h.key.toLowerCase() === key.toLowerCase())) headers.push({ key, value, enabled: true });
}

function mapBody(op: Json, method: string, headers: KeyValue[], where: string, ctx: Ctx): Body {
  const requestBody = deref(op.requestBody, ctx);
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) return NO_BODY;
  const content = requestBody.content;
  const keys = Object.keys(content);
  if (keys.length === 0) return NO_BODY;

  const key =
    keys.find((k) => /json/i.test(k)) ??
    keys.find((k) => /xml/i.test(k)) ??
    keys.find((k) => k.toLowerCase() === "application/x-www-form-urlencoded") ??
    keys.find((k) => k.toLowerCase().startsWith("multipart/")) ??
    keys[0];
  const media = isRecord(content[key]) ? content[key] : {};
  const kind = key.toLowerCase();
  const example = mediaExample(media, ctx);
  const generated = (): unknown => (example !== undefined ? example : sample(media.schema, ctx, 0, new Set(), true));

  let body: Body = NO_BODY;
  if (/json/.test(kind)) {
    body = { type: "json", content: JSON.stringify(generated() ?? null, null, 2) };
    if (kind !== "application/json") addHeader(headers, "Content-Type", key);
  } else if (/xml/.test(kind)) {
    const value = generated();
    body = { type: "xml", content: typeof value === "string" ? value : toXml("root", value, 0) };
    if (kind !== "application/xml") addHeader(headers, "Content-Type", key);
  } else if (kind === "application/x-www-form-urlencoded") {
    const value = generated();
    const fields = isRecord(value) ? Object.entries(value).map(([k, v]) => ({ key: k, value: stringify(v), enabled: true })) : [];
    if (fields.length > 0) body = { type: "urlencoded", fields };
  } else if (kind.startsWith("multipart/")) {
    const value = generated();
    const properties = withSchema(media.schema, new Set(), ctx, (s): Json => (isRecord(s.properties) ? s.properties : {}), {});
    const fields: Array<{ kind: "text"; key: string; value: string; enabled: boolean }> = [];
    for (const [k, v] of Object.entries(isRecord(value) ? value : {})) {
      if (withSchema(properties[k], new Set(), ctx, (s) => s.format === "binary", false)) {
        ctx.warnings.add(`${where} : champ fichier « ${k} » ignoré (un fichier ne peut pas être décrit dans une collection).`);
        continue;
      }
      fields.push({ kind: "text", key: k, value: stringify(v), enabled: true });
    }
    if (fields.length > 0) body = { type: "form-data", fields };
  } else if (kind.startsWith("text/")) {
    const value = generated();
    if (typeof value === "string" && value !== "") body = { type: "raw", content: value, contentType: key };
  } else {
    ctx.warnings.add(`${where} : body « ${key} » non supporté (binaire), ignoré.`);
  }

  if ((method === "GET" || method === "HEAD") && body.type !== "none") {
    ctx.warnings.add(`${where} : body ignoré (les requêtes ${method} ne peuvent pas en avoir dans cette plateforme).`);
    return NO_BODY;
  }
  return body;
}

// --- Tests de contrat ----------------------------------------------------------------------------------------------

/** Statut 2xx attendu, et conformité de la réponse JSON au schéma déclaré. */
function buildTests(op: Json, where: string, ctx: Ctx): Assertion[] {
  const responses = isRecord(op.responses) ? op.responses : {};
  const codes: number[] = [];
  const schemas: unknown[] = [];

  for (const [code, raw] of Object.entries(responses)) {
    if (!/^2\d\d$/.test(code)) continue;
    codes.push(Number(code));
    const response = deref(raw, ctx);
    const content = isRecord(response) && isRecord(response.content) ? response.content : {};
    const jsonKey = Object.keys(content).find((k) => /json/i.test(k));
    const media = jsonKey ? content[jsonKey] : undefined;
    if (isRecord(media) && media.schema !== undefined) schemas.push(media.schema);
  }

  const tests: Assertion[] = [];
  if (codes.length > 0) tests.push({ type: "status", expected: codes.length === 1 ? codes[0] : codes });

  if (schemas.length === 1) {
    const converted = convert(schemas[0], ctx, 0, new Set());
    if (hasConstraints(converted)) {
      tests.push({ type: "jsonSchema", schema: converted, label: "Réponse conforme au schéma OpenAPI" });
    }
  } else if (schemas.length > 1) {
    // Plusieurs réponses 2xx avec des schémas différents : on ne peut pas savoir laquelle sera renvoyée.
    ctx.warnings.add(`${where} : plusieurs réponses 2xx avec un schéma : l'assertion de conformité n'est pas générée.`);
  }
  return tests;
}

// --- Opérations ----------------------------------------------------------------------------------------------------

function buildItem(path: string, method: string, op: Json, pathItem: Json, ctx: Ctx): RequestItem {
  const upper = method.toUpperCase();
  const name = (str(op.summary)?.trim() || str(op.operationId)?.trim() || `${upper} ${path}`).slice(0, 200);
  const where = `« ${name} »`;

  const params: KeyValue[] = [];
  const headers: KeyValue[] = [];
  const pathValues = new Map<string, string | undefined>();

  for (const p of collectParameters(pathItem, op, ctx)) {
    const pname = p.name as string;
    const location = p.in as string;
    if (location === "path") {
      pathValues.set(pname, declaredValue(p, ctx));
    } else if (location === "query" || location === "header") {
      if (location === "header" && IGNORED_HEADERS.has(pname.toLowerCase())) continue;
      const value = declaredValue(p, ctx) ?? "";
      const required = p.required === true;
      if (required && value === "") ctx.warnings.add(`${where} : paramètre requis « ${pname} » sans exemple : renseigne sa valeur.`);
      // Un paramètre facultatif est désactivé par défaut : on l'active quand on en a besoin.
      pushKeyValue(location === "query" ? params : headers, pname, value, required, where, ctx);
    } else {
      ctx.warnings.add(`${where} : paramètre ${location} « ${pname} » ignoré (non supporté).`);
    }
  }

  const template = path.replace(/\{([^}]+)\}/g, (_match, raw: string) => {
    const variable = sanitizeVar(raw);
    const declared = pathValues.get(raw);
    if (declared === undefined) {
      ctx.warnings.add(`${where} : paramètre de chemin « ${raw} » sans exemple : renseigne la variable « ${variable} ».`);
    }
    addVariable(ctx, variable, declared ?? "");
    return `{{${variable}}}`;
  });

  let authMode: RequestItem["authMode"] = "inherit";
  let auth: Auth = { type: "none" };
  if (Array.isArray(op.security)) {
    const security = op.security.length === 0 ? ({ kind: "none" } as Security) : mapSecurity(op.security, where, ctx);
    authMode = "own";
    if (security.kind === "auth") auth = security.auth;
  }

  const request: HttpRequest = {
    name,
    method: upper as HttpMethod,
    url: `{{baseUrl}}${template}`,
    params,
    headers,
    body: mapBody(op, upper, headers, where, ctx),
    auth,
    followRedirects: true,
  };

  return {
    type: "request",
    id: newItemId(ctx),
    name,
    description: describe(op.description) ?? describe(op.summary),
    request,
    authMode,
    tests: buildTests(op, where, ctx),
    extract: [],
    scripts: undefined,
  };
}

function mapServers(spec: Json, ctx: Ctx): void {
  const servers = Array.isArray(spec.servers) ? spec.servers.filter(isRecord) : [];
  let url = "";

  if (servers.length === 0) {
    ctx.warnings.add("Aucun serveur déclaré : renseigne la variable « baseUrl ».");
  } else {
    const variables = isRecord(servers[0].variables) ? servers[0].variables : {};
    url = String(servers[0].url ?? "")
      .replace(/\{([^}]+)\}/g, (match, name: string) => {
        const v = variables[name];
        return isRecord(v) && v.default !== undefined ? String(v.default) : match;
      })
      .replace(/\/+$/, "");
    if (servers.length > 1) ctx.warnings.add(`${servers.length} serveurs déclarés : le premier est utilisé pour « baseUrl ».`);
    if (!/^https?:\/\//i.test(url)) ctx.warnings.add(`L'URL du serveur (« ${url} ») n'est pas absolue : complète la variable « baseUrl ».`);
  }
  addVariable(ctx, "baseUrl", url);
}

/** Importe une spécification OpenAPI 3.x (déjà analysée) vers le format interne. */
export function importOpenApi(spec: unknown, options: ImportOptions = {}): ImportResult<Collection> {
  if (!isRecord(spec)) throw new CollectionError("Ce document n'est pas une spécification OpenAPI.");
  if (typeof spec.swagger === "string") {
    throw new CollectionError(`Swagger ${spec.swagger} n'est pas supporté : convertis la spécification en OpenAPI 3.`);
  }
  const version = str(spec.openapi);
  if (!version || !version.startsWith("3.")) {
    throw new CollectionError("Ce document n'est pas une spécification OpenAPI 3 (champ « openapi » attendu, par exemple 3.0.3).");
  }
  if (!isRecord(spec.paths)) throw new CollectionError("La spécification ne contient pas de « paths ».");

  const ctx: Ctx = {
    root: spec,
    warnings: new Warnings(),
    makeId: options.idFactory ?? newId,
    ids: new Set(),
    variables: new Map(),
    requests: 0,
    skipped: 0,
  };
  const info = isRecord(spec.info) ? spec.info : {};

  mapServers(spec, ctx);

  // Un dossier par tag, dans l'ordre de la section « tags », puis dans l'ordre de découverte.
  const folders = new Map<string, FolderItem>();
  const newFolder = (name: string, description?: string): FolderItem => ({
    type: "folder",
    id: newItemId(ctx),
    name: name.slice(0, 200),
    description,
    items: [],
  });
  for (const tag of Array.isArray(spec.tags) ? spec.tags : []) {
    if (isRecord(tag) && typeof tag.name === "string" && tag.name) folders.set(tag.name, newFolder(tag.name, describe(tag.description)));
  }
  const untagged: CollectionItem[] = [];

  for (const [path, rawPathItem] of Object.entries(spec.paths)) {
    if (path.startsWith("x-")) continue;
    if (!path.startsWith("/")) {
      ctx.warnings.add(`Chemin « ${path} » ignoré (il doit commencer par « / »).`);
      ctx.skipped++;
      continue;
    }
    const pathItem = deref(rawPathItem, ctx);
    if (!isRecord(pathItem)) continue;

    if ("trace" in pathItem) {
      ctx.warnings.add(`${path} : la méthode TRACE n'est pas supportée, ignorée.`);
      ctx.skipped++;
    }

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isRecord(op)) continue;

      ctx.requests++;
      if (ctx.requests > COLLECTION_LIMITS.maxRequests) {
        throw new CollectionError(`Trop d'opérations (maximum ${COLLECTION_LIMITS.maxRequests}).`);
      }
      const item = buildItem(path, method, op, pathItem, ctx);

      const tag = Array.isArray(op.tags) && typeof op.tags[0] === "string" ? op.tags[0] : undefined;
      if (tag === undefined) {
        untagged.push(item);
      } else {
        let folder = folders.get(tag);
        if (!folder) {
          folder = newFolder(tag);
          folders.set(tag, folder);
        }
        folder.items.push(item);
      }
    }
  }

 if (ctx.requests === 0) ctx.warnings.add("Aucune opération trouvée dans la spécification.");

const usedFolders = [...folders.values()].filter((f) => f.items.length > 0);

const auth =
  Array.isArray(spec.security) && spec.security.length > 0
    ? globalAuth(spec.security, ctx)
    : undefined;

const collection = parseCollection({
  format: COLLECTION_FORMAT,
  version: 1,
  id: newItemId(ctx),
  name: (str(info.title)?.trim() || "API importée").slice(0, 200),
  description: describe(info.description),
  variables: [...ctx.variables.values()],
  auth,
  items: [...usedFolders, ...untagged],
});

  return {
    value: collection,
    warnings: ctx.warnings.toArray(),
    stats: { requests: ctx.requests, folders: usedFolders.length, skipped: ctx.skipped },
  };
}

function globalAuth(requirements: unknown[], ctx: Ctx): Auth | undefined {
  const security = mapSecurity(requirements, "Sécurité globale", ctx);
  return security.kind === "auth" ? security.auth : undefined;
}