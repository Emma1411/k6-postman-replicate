import {
  COLLECTION_FORMAT,
  CollectionError,
  COLLECTION_LIMITS,
  ENVIRONMENT_FORMAT,
  newId,
  parseCollection,
  parseEnvironment,
} from "@/shared/schemas";
import type { Auth, Collection, CollectionItem, Environment, HttpMethod, HttpRequest, RequestItem, Scripts, VariableEntry } from "@/shared/schemas";
import { Warnings } from "./warnings";

export interface ImportOptions {
  /** Générateur d'identifiants (déterministe dans les tests). */
  idFactory?: () => string;
}

export interface ImportStats {
  requests: number;
  folders: number;
  /** Éléments non importés (méthode non supportée, requête illisible…). */
  skipped: number;
}

export interface ImportResult<T> {
  value: T;
  warnings: string[];
  stats: ImportStats;
}

type KeyValue = { key: string; value: string; enabled: boolean };
type Body = HttpRequest["body"];

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const FORBIDDEN_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "keep-alive", "proxy-connection"]);
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const MAX_SCRIPT = 100_000;
const NO_BODY: Body = { type: "none" };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface Ctx {
  warnings: Warnings;
  makeId: () => string;
  usedIds: Set<string>;
  requests: number;
  folders: number;
  skipped: number;
  hoisted: Map<string, VariableEntry>;
}

function takeId(ctx: Ctx, candidate: unknown): string {
  if (typeof candidate === "string" && ITEM_ID.test(candidate) && !ctx.usedIds.has(candidate)) {
    ctx.usedIds.add(candidate);
    return candidate;
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = ctx.makeId();
    if (ITEM_ID.test(id) && !ctx.usedIds.has(id)) {
      ctx.usedIds.add(id);
      return id;
    }
  }
  throw new CollectionError("Impossible de générer un identifiant valide.");
}

function describe(v: unknown): string | undefined {
  const source = typeof v === "string" ? v : isRecord(v) ? str(v.content) : undefined;
  const trimmed = source?.trim();
  return trimmed ? trimmed.slice(0, 10_000) : undefined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pushKeyValue(out: KeyValue[], key: string, value: string, enabled: boolean, where: string, ctx: Ctx): void {
  if (key.length > 256 || value.length > 8192) {
    ctx.warnings.add(`${where} : « ${key.slice(0, 40)} » est trop long (256 caractères pour le nom, 8 192 pour la valeur), ignoré.`);
    return;
  }
  out.push({ key, value, enabled });
}

// --- Scripts, variables, authentification -------------------------------------------------------------------------

function mapEvents(events: unknown, where: string, ctx: Ctx): Scripts | undefined {
  const scripts: Scripts = {};
  for (const e of list(events)) {
    if (!isRecord(e) || !isRecord(e.script)) continue;
    const exec = e.script.exec;
    const source = Array.isArray(exec) ? exec.map(text).join("\n") : typeof exec === "string" ? exec : "";
    if (!source.trim()) continue;
    if (source.length > MAX_SCRIPT) {
      ctx.warnings.add(`${where} : script de plus de ${MAX_SCRIPT} caractères, ignoré.`);
      continue;
    }
    if (e.listen === "prerequest") scripts.preRequest = source;
    else if (e.listen === "test") scripts.test = source;
  }
  return scripts.preRequest !== undefined || scripts.test !== undefined ? scripts : undefined;
}

function mapVariables(raw: unknown, where: string, ctx: Ctx): VariableEntry[] {
  const out: VariableEntry[] = [];
  for (const v of list(raw)) {
    if (!isRecord(v)) continue;
    const key = str(v.key);
    if (!key) continue;
    if (!VARIABLE_NAME.test(key)) {
      ctx.warnings.add(`${where} : variable « ${key} » ignorée (nom invalide : lettres, chiffres, _, - et . uniquement, sans commencer par un chiffre).`);
      continue;
    }
    const value = text(v.value);
    if (value.length > 16_384) {
      ctx.warnings.add(`${where} : valeur de la variable « ${key} » trop longue, ignorée.`);
      continue;
    }
    out.push({ key, value, enabled: v.disabled !== true, secret: v.type === "secret" });
  }
  return out;
}

type AuthMapping = { kind: "ok"; auth: Auth } | { kind: "unsupported" };

/** Postman stocke les paramètres en tableau [{key, value}] (v2.1) ou en objet (v2.0). */
function authParam(raw: Record<string, unknown>, type: string, key: string): string | undefined {
  const block = raw[type];
  if (Array.isArray(block)) {
    const entry = block.find((e) => isRecord(e) && e.key === key);
    return isRecord(entry) && entry.value !== null && entry.value !== undefined ? String(entry.value) : undefined;
  }
  if (isRecord(block) && block[key] !== null && block[key] !== undefined) return String(block[key]);
  return undefined;
}

/** null = pas d'authentification déclarée (héritage). */
function mapAuth(raw: unknown, where: string, ctx: Ctx): AuthMapping | null {
  if (!isRecord(raw)) return null;
  const type = str(raw.type)?.toLowerCase();
  if (!type || type === "inherit") return null;
  const get = (key: string) => authParam(raw, type, key);

  switch (type) {
    case "noauth":
      return { kind: "ok", auth: { type: "none" } };
    case "basic":
      return { kind: "ok", auth: { type: "basic", username: get("username") ?? "", password: get("password") ?? "" } };
    case "bearer":
      return { kind: "ok", auth: { type: "bearer", token: get("token") ?? "" } };
    case "apikey": {
      const key = get("key");
      if (!key) break;
      return { kind: "ok", auth: { type: "apiKey", key, value: get("value") ?? "", in: get("in") === "query" ? "query" : "header" } };
    }
    case "oauth2": {
      const token = get("accessToken");
      if (token && (get("addTokenTo") ?? "header") === "header") {
        ctx.warnings.add(`${where} : OAuth 2.0 converti en jeton Bearer fixe : le jeton ne sera pas renouvelé.`);
        return { kind: "ok", auth: { type: "bearer", token } };
      }
      ctx.warnings.add(`${where} : OAuth 2.0 sans jeton utilisable (ou ajouté à l'URL) : authentification ignorée.`);
      return { kind: "unsupported" };
    }
    default:
      ctx.warnings.add(`${where} : authentification « ${type} » non supportée, ignorée.`);
      return { kind: "unsupported" };
  }
  ctx.warnings.add(`${where} : authentification « ${type} » incomplète, ignorée.`);
  return { kind: "unsupported" };
}

// --- Requêtes -----------------------------------------------------------------------------------------------------

const urlSegment = (p: unknown): string => (typeof p === "string" ? p : isRecord(p) ? text(p.value) : text(p));

function buildRaw(url: Record<string, unknown>): string {
  const protocol = str(url.protocol);
  const host = Array.isArray(url.host) ? url.host.map(text).join(".") : text(url.host);
  const port = url.port !== undefined && url.port !== null && url.port !== "" ? `:${text(url.port)}` : "";
  const path = Array.isArray(url.path) ? url.path.map(urlSegment).join("/") : text(url.path);
  return `${protocol ? `${protocol}://` : ""}${host}${port}${path ? `/${path}` : ""}`;
}

function entriesToParams(entries: unknown[], where: string, ctx: Ctx): KeyValue[] {
  const out: KeyValue[] = [];
  for (const e of entries) {
    if (!isRecord(e)) continue;
    const key = str(e.key);
    if (!key) continue;
    pushKeyValue(out, key, text(e.value), e.disabled !== true, where, ctx);
  }
  return out;
}

function parseQueryString(query: string, where: string, ctx: Ctx): KeyValue[] {
  const out: KeyValue[] = [];
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
    if (!key) continue;
    pushKeyValue(out, key, eq < 0 ? "" : safeDecode(pair.slice(eq + 1)), true, where, ctx);
  }
  return out;
}

/** L'URL du format interne ne contient pas la query : elle est portée par `params`, comme dans l'API Client. */
function mapUrl(raw: unknown, where: string, ctx: Ctx): { url: string; params: KeyValue[] } {
  let rawText = "";
  let queryEntries: unknown[] | undefined;
  const pathVars: Record<string, string> = {};

  if (typeof raw === "string") {
    rawText = raw;
  } else if (isRecord(raw)) {
    rawText = str(raw.raw) ?? buildRaw(raw);
    if (Array.isArray(raw.query)) queryEntries = raw.query;
    for (const v of list(raw.variable)) {
      if (isRecord(v) && typeof v.key === "string" && v.value !== undefined && v.value !== null && String(v.value) !== "") {
        pathVars[v.key] = String(v.value);
      }
    }
  }

  const hash = rawText.indexOf("#");
  if (hash >= 0) rawText = rawText.slice(0, hash);
  const q = rawText.indexOf("?");
  let base = (q >= 0 ? rawText.slice(0, q) : rawText).trim();
  const params = queryEntries ? entriesToParams(queryEntries, where, ctx) : parseQueryString(q >= 0 ? rawText.slice(q + 1) : "", where, ctx);

  base = base.replace(/\/:([A-Za-z_][A-Za-z0-9_-]*)(?=\/|$)/g, (match, variable: string) => {
    if (Object.prototype.hasOwnProperty.call(pathVars, variable)) return `/${pathVars[variable]}`;
    ctx.warnings.add(`${where} : la variable de chemin « :${variable} » n'a pas de valeur ; elle est conservée telle quelle dans l'URL.`);
    return match;
  });
  return { url: base, params };
}

function mapHeaders(raw: unknown, where: string, ctx: Ctx): KeyValue[] {
  const out: KeyValue[] = [];
  for (const h of list(raw)) {
    if (!isRecord(h)) continue;
    const key = str(h.key)?.trim();
    if (!key) continue;
    const value = text(h.value);
    if (!HEADER_NAME.test(key)) {
      ctx.warnings.add(`${where} : header « ${key.slice(0, 40)} » ignoré (nom invalide).`);
    } else if (FORBIDDEN_HEADERS.has(key.toLowerCase())) {
      ctx.warnings.add(`${where} : header « ${key} » ignoré (géré automatiquement lors de l'envoi).`);
    } else if (/[\r\n\0]/.test(value)) {
      ctx.warnings.add(`${where} : header « ${key} » ignoré (saut de ligne dans la valeur).`);
    } else {
      pushKeyValue(out, key, value, h.disabled !== true, where, ctx);
    }
  }
  return out;
}

function mapBody(raw: unknown, method: string, where: string, ctx: Ctx): Body {
  if (!isRecord(raw) || raw.disabled === true || typeof raw.mode !== "string") return NO_BODY;
  let body: Body = NO_BODY;

  switch (raw.mode) {
    case "raw": {
      const content = text(raw.raw);
      if (content === "") break;
      const options = isRecord(raw.options) && isRecord(raw.options.raw) ? raw.options.raw : {};
      const language = str(options.language)?.toLowerCase();
      if (language === "json") body = { type: "json", content };
      else if (language === "xml") body = { type: "xml", content };
      else {
        const contentType = language === "html" ? "text/html" : language === "javascript" ? "application/javascript" : "text/plain";
        body = { type: "raw", content, contentType };
      }
      break;
    }
    case "urlencoded": {
      const fields = entriesToParams(list(raw.urlencoded), where, ctx);
      if (fields.length > 0) body = { type: "urlencoded", fields };
      break;
    }
    case "formdata": {
      const fields: Array<{ kind: "text"; key: string; value: string; enabled: boolean }> = [];
      for (const f of list(raw.formdata)) {
        if (!isRecord(f)) continue;
        const key = str(f.key);
        if (!key) continue;
        if (f.type === "file") {
          ctx.warnings.add(`${where} : champ fichier « ${key} » ignoré (le contenu du fichier n'est pas inclus dans une collection).`);
          continue;
        }
        const target: KeyValue[] = [];
        pushKeyValue(target, key, text(f.value), f.disabled !== true, where, ctx);
        if (target[0]) fields.push({ kind: "text", ...target[0] });
      }
      if (fields.length > 0) body = { type: "form-data", fields };
      break;
    }
    case "graphql": {
      const g = raw.graphql;
      if (!isRecord(g)) break;
      const query = text(g.query);
      const variablesText = text(g.variables).trim();
      let variables: unknown;
      if (variablesText) {
        try {
          variables = JSON.parse(variablesText);
        } catch {
          variables = variablesText;
        }
      }
      body = { type: "json", content: JSON.stringify(variables === undefined ? { query } : { query, variables }) };
      break;
    }
    case "file":
      ctx.warnings.add(`${where} : body binaire (fichier) ignoré : le contenu du fichier n'est pas inclus dans une collection.`);
      break;
    default:
      ctx.warnings.add(`${where} : type de body « ${raw.mode} » non supporté, ignoré.`);
  }

  if ((method === "GET" || method === "HEAD") && body.type !== "none") {
    ctx.warnings.add(`${where} : body ignoré (les requêtes ${method} ne peuvent pas en avoir dans cette plateforme).`);
    return NO_BODY;
  }
  return body;
}

function mapRequest(node: Record<string, unknown>, name: string, ctx: Ctx): RequestItem | null {
  const where = `« ${name} »`;
  const raw = typeof node.request === "string" ? { method: "GET", url: node.request } : node.request;
  if (!isRecord(raw)) {
    ctx.skipped++;
    ctx.warnings.add(`${where} : requête illisible, ignorée.`);
    return null;
  }

  const method = text(raw.method || "GET").toUpperCase();
  if (!METHODS.has(method)) {
    ctx.skipped++;
    ctx.warnings.add(`${where} : méthode ${method} non supportée, requête ignorée.`);
    return null;
  }

  ctx.requests++;
  if (ctx.requests > COLLECTION_LIMITS.maxRequests) {
    throw new CollectionError(`Trop de requêtes (maximum ${COLLECTION_LIMITS.maxRequests}).`);
  }

  const { url, params } = mapUrl(raw.url, where, ctx);
  const mapping = mapAuth(raw.auth, where, ctx);
  const profile = isRecord(node.protocolProfileBehavior) ? node.protocolProfileBehavior : {};

  const request: HttpRequest = {
    name,
    method: method as HttpMethod,
    url,
    params,
    headers: mapHeaders(raw.header, where, ctx),
    body: mapBody(raw.body, method, where, ctx),
    auth: mapping?.kind === "ok" ? mapping.auth : { type: "none" },
    followRedirects: profile.followRedirects !== false,
  };

  return {
    type: "request",
    id: takeId(ctx, node.id),
    name,
    description: describe(node.description ?? raw.description),
    request,
    // Sans authentification déclarée, Postman hérite du dossier puis de la collection.
    authMode: mapping === null ? "inherit" : "own",
    tests: [],
    extract: [],
    scripts: mapEvents(node.event, where, ctx),
  };
}

function mapItems(nodes: unknown[], depth: number, ctx: Ctx): CollectionItem[] {
  if (depth > COLLECTION_LIMITS.maxDepth) {
    throw new CollectionError(`Dossiers imbriqués sur plus de ${COLLECTION_LIMITS.maxDepth} niveaux.`);
  }

  const out: CollectionItem[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const name = (str(node.name)?.trim() || "Sans nom").slice(0, 200);

    if (Array.isArray(node.item)) {
      ctx.folders++;
      const where = `Dossier « ${name} »`;
      for (const v of mapVariables(node.variable, where, ctx)) {
        if (!ctx.hoisted.has(v.key)) {
          ctx.hoisted.set(v.key, v);
          ctx.warnings.add(`${where} : variable « ${v.key} » déplacée au niveau de la collection (les dossiers n'ont pas de variables propres).`);
        }
      }
      const auth = mapAuth(node.auth, where, ctx);
      out.push({
        type: "folder",
        id: takeId(ctx, node.id),
        name,
        description: describe(node.description),
        auth: auth?.kind === "ok" ? auth.auth : undefined,
        scripts: mapEvents(node.event, where, ctx),
        items: mapItems(node.item, depth + 1, ctx),
      });
    } else if (node.request !== undefined) {
      const item = mapRequest(node, name, ctx);
      if (item) out.push(item);
    } else {
      ctx.skipped++;
      ctx.warnings.add(`« ${name} » : élément sans requête ni contenu, ignoré.`);
    }
  }
  return out;
}

function newCtx(options: ImportOptions): Ctx {
  return {
    warnings: new Warnings(),
    makeId: options.idFactory ?? newId,
    usedIds: new Set(),
    requests: 0,
    folders: 0,
    skipped: 0,
    hoisted: new Map(),
  };
}

/** Importe une collection Postman v2.0 ou v2.1 (déjà analysée) vers le format interne. */

export function importPostmanCollection(input: unknown, options: ImportOptions = {}): ImportResult<Collection> {
  if (!isRecord(input) || !isRecord(input.info) || !Array.isArray(input.item)) {
    throw new CollectionError("Ce JSON n'est pas une collection Postman (champs « info » et « item » attendus).");
  }

  const schema = str(input.info.schema) ?? "";
  if (schema && !/getpostman\.com\/json\/collection\/v2\.[01]/.test(schema)) {
    throw new CollectionError(`Version de collection non supportée : ${schema}. Exporte la collection au format v2.1.`);
  }

  const ctx = newCtx(options);
  const where = "Collection";
  const name = (str(input.info.name)?.trim() || "Collection importée").slice(0, 200);

  // Réserver l'identifiant de la collection avant ceux des dossiers et requêtes.
  const collectionId = takeId(ctx, input.info._postman_id);

  const collectionVariables = mapVariables(input.variable, where, ctx);
  const known = new Set(collectionVariables.map((v) => v.key));
  const variables = [...collectionVariables, ...[...ctx.hoisted.values()].filter((v) => !known.has(v.key))];

  const auth = mapAuth(input.auth, where, ctx);
  const items = mapItems(input.item, 1, ctx);

  // Les variables de dossier sont connues après le parcours : on les ajoute sans écraser celles de la collection.
  const allKeys = new Set(variables.map((v) => v.key));
  for (const v of ctx.hoisted.values()) {
    if (!allKeys.has(v.key)) variables.push(v);
  }

  const collection = parseCollection({
    format: COLLECTION_FORMAT,
    version: 1,
    id: collectionId,
    name,
    description: describe(input.info.description),
    variables,
    auth: auth?.kind === "ok" ? auth.auth : undefined,
    scripts: mapEvents(input.event, where, ctx),
    items,
  });

  return {
    value: collection,
    warnings: ctx.warnings.toArray(),
    stats: { requests: ctx.requests, folders: ctx.folders, skipped: ctx.skipped },
  };
}


/** Importe un environnement Postman (champ `values`). Les variables désactivées sont conservées, désactivées. */
export function importPostmanEnvironment(
  input: unknown,
  options: ImportOptions = {},
): { value: Environment; warnings: string[] } {
  if (!isRecord(input) || !Array.isArray(input.values)) {
    throw new CollectionError("Ce JSON n'est pas un environnement Postman (champ « values » attendu).");
  }
  const ctx = newCtx(options);
  const variables: VariableEntry[] = [];

  for (const v of input.values) {
    if (!isRecord(v)) continue;
    const key = str(v.key);
    if (!key) continue;
    if (!VARIABLE_NAME.test(key)) {
      ctx.warnings.add(`Variable « ${key} » ignorée (nom invalide : lettres, chiffres, _, - et . uniquement, sans commencer par un chiffre).`);
      continue;
    }
    const value = text(v.value);
    if (value.length > 16_384) {
      ctx.warnings.add(`Variable « ${key} » : valeur trop longue, ignorée.`);
      continue;
    }
    variables.push({ key, value, enabled: v.enabled !== false, secret: v.type === "secret" });
  }

  const environment = parseEnvironment({
    format: ENVIRONMENT_FORMAT,
    version: 1,
    id: takeId(ctx, input.id),
    name: (str(input.name)?.trim() || "Environnement importé").slice(0, 200),
    variables,
  });
  return { value: environment, warnings: ctx.warnings.toArray() };
}