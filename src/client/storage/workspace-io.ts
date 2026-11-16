import { CollectionError, parseCollection, parseEnvironment } from "@/shared/schemas";
import type { Auth, Collection, CollectionItem, Environment, VariableEntry } from "@/shared/schemas";
import {
  deleteCollection,
  deleteEnvironment,
  listCollections,
  listEnvironments,
  listSettings,
  saveCollection,
  saveEnvironment,
  setSetting,
} from "./repositories";

export const WORKSPACE_FORMAT = "api-engineering-platform/workspace" as const;
export const MAX_WORKSPACE_CHARS = 50 * 1024 * 1024;
const MAX_ITEMS = 200;

export interface WorkspaceExport {
  format: typeof WORKSPACE_FORMAT;
  version: 1;
  exportedAt: string;
  /** false : les secrets ont été vidés à l'export. */
  secretsIncluded: boolean;
  collections: Collection[];
  environments: Environment[];
  settings: Record<string, unknown>;
}

/* ───────── Masquage des secrets ───────── */

// Heuristique : variables marquées « secret », identifiants d'authentification, en-têtes et paramètres usuels.
// Elle ne détecte PAS un secret écrit dans un corps de requête, une URL ou une variable non marquée.
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|x-api-key|x-auth-token)$/i;
const SENSITIVE_PARAMS = /^(api[_-]?key|access[_-]?token|token|secret|password)$/i;

function maskAuth(auth: Auth): Auth {
  switch (auth.type) {
    case "basic":
      return { ...auth, password: "" };
    case "bearer":
      return { ...auth, token: "" };
    case "apiKey":
      return { ...auth, value: "" };
    default:
      return auth;
  }
}

const maskVariables = (variables: VariableEntry[]): VariableEntry[] =>
  variables.map((v) => (v.secret ? { ...v, value: "" } : v));

function maskItems(items: CollectionItem[]): CollectionItem[] {
  return items.map((item) => {
    if (item.type === "folder") {
      return { ...item, auth: item.auth ? maskAuth(item.auth) : undefined, items: maskItems(item.items) };
    }
    return {
      ...item,
      request: {
        ...item.request,
        auth: maskAuth(item.request.auth),
        headers: item.request.headers.map((h) => (SENSITIVE_HEADERS.test(h.key) ? { ...h, value: "" } : h)),
        params: item.request.params.map((p) => (SENSITIVE_PARAMS.test(p.key) ? { ...p, value: "" } : p)),
      },
    };
  });
}

export function maskCollectionSecrets(collection: Collection): Collection {
  return {
    ...collection,
    auth: collection.auth ? maskAuth(collection.auth) : undefined,
    variables: maskVariables(collection.variables),
    items: maskItems(collection.items),
  };
}

export function maskEnvironmentSecrets(environment: Environment): Environment {
  return { ...environment, variables: maskVariables(environment.variables) };
}

/* ───────── Export ───────── */

export async function exportWorkspace(options: { includeSecrets?: boolean; now?: Date } = {}): Promise<WorkspaceExport> {
  const includeSecrets = options.includeSecrets ?? false;
  const [collections, environments, settings] = await Promise.all([
    listCollections(),
    listEnvironments(),
    listSettings(),
  ]);
  return {
    format: WORKSPACE_FORMAT,
    version: 1,
    exportedAt: (options.now ?? new Date()).toISOString(),
    secretsIncluded: includeSecrets,
    collections: includeSecrets ? collections : collections.map(maskCollectionSecrets),
    environments: includeSecrets ? environments : environments.map(maskEnvironmentSecrets),
    settings,
  };
}

export const workspaceToJson = (workspace: WorkspaceExport): string => JSON.stringify(workspace, null, 2);

/* ───────── Import ───────── */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function withPath<T>(prefix: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CollectionError) {
      throw new CollectionError(err.message, err.path ? `${prefix}.${err.path}` : prefix);
    }
    throw err;
  }
}

function listOf(raw: unknown, name: string): unknown[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new CollectionError(`« ${name} » doit être une liste.`, name);
  if (raw.length > MAX_ITEMS) throw new CollectionError(`Trop d'éléments dans « ${name} » (maximum ${MAX_ITEMS}).`, name);
  return raw;
}

/** Valide un fichier d'espace de travail. Lève CollectionError, avec le chemin de l'élément fautif. */
export function parseWorkspace(input: unknown): WorkspaceExport {
  let raw = input;
  if (typeof input === "string") {
    if (input.length > MAX_WORKSPACE_CHARS) throw new CollectionError("Fichier trop volumineux (50 Mo maximum).");
    try {
      raw = JSON.parse(input);
    } catch {
      throw new CollectionError("Le fichier n'est pas du JSON valide.");
    }
  }
  if (!isRecord(raw) || raw.format !== WORKSPACE_FORMAT) {
    throw new CollectionError(`Ce fichier n'est pas un espace de travail de cet outil (format attendu : ${WORKSPACE_FORMAT}).`);
  }
  if (raw.version !== 1) throw new CollectionError(`Version non supportée : ${String(raw.version)}.`);

  const collections = listOf(raw.collections, "collections").map((c, i) =>
    withPath(`collections[${i}]`, () => parseCollection(c)),
  );
  const environments = listOf(raw.environments, "environments").map((e, i) =>
    withPath(`environments[${i}]`, () => parseEnvironment(e)),
  );
  return {
    format: WORKSPACE_FORMAT,
    version: 1,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    secretsIncluded: raw.secretsIncluded === true,
    collections,
    environments,
    settings: isRecord(raw.settings) ? raw.settings : {},
  };
}

export type ImportMode = "merge" | "replace";

interface Named {
  id: string;
  name: string;
}
export interface ImportPlan {
  mode: ImportMode;
  collections: { added: Named[]; replaced: Named[]; removed: Named[] };
  environments: { added: Named[]; replaced: Named[]; removed: Named[] };
  /** Le fichier a été exporté sans secrets : importer écrase les secrets locaux de même identifiant. */
  secretsMasked: boolean;
}

function planFor(incoming: Named[], existing: Named[], mode: ImportMode) {
  const existingIds = new Set(existing.map((e) => e.id));
  const incomingIds = new Set(incoming.map((e) => e.id));
  return {
    added: incoming.filter((e) => !existingIds.has(e.id)).map(({ id, name }) => ({ id, name })),
    replaced: incoming.filter((e) => existingIds.has(e.id)).map(({ id, name }) => ({ id, name })),
    removed: mode === "replace" ? existing.filter((e) => !incomingIds.has(e.id)).map(({ id, name }) => ({ id, name })) : [],
  };
}

/** Ce que l'import ferait, sans rien écrire : à afficher avant confirmation. */
export function planImport(
  workspace: WorkspaceExport,
  mode: ImportMode,
  existing: { collections: Named[]; environments: Named[] },
): ImportPlan {
  return {
    mode,
    collections: planFor(workspace.collections, existing.collections, mode),
    environments: planFor(workspace.environments, existing.environments, mode),
    secretsMasked: !workspace.secretsIncluded,
  };
}

export async function previewImport(workspace: WorkspaceExport, mode: ImportMode): Promise<ImportPlan> {
  const [collections, environments] = await Promise.all([listCollections(), listEnvironments()]);
  return planImport(workspace, mode, { collections, environments });
}

export async function importWorkspace(workspace: WorkspaceExport, mode: ImportMode): Promise<ImportPlan> {
  const plan = await previewImport(workspace, mode);
  for (const collection of workspace.collections) await saveCollection(collection);
  for (const environment of workspace.environments) await saveEnvironment(environment);
  for (const { id } of plan.collections.removed) await deleteCollection(id);
  for (const { id } of plan.environments.removed) await deleteEnvironment(id);
  for (const [key, value] of Object.entries(workspace.settings)) await setSetting(key, value);
  return plan;
}