import { CollectionError, WorkflowSchema } from "@/shared/schemas";
import type { Auth, Collection, CollectionItem, Environment, FolderItem, HttpRequest, RequestItem, Scripts, Workflow } from "@/shared/schemas";
import type { Assertion, Extractor } from "@/shared/schemas";
import { Warnings } from "./warnings";

export function walkRequests(
  items: CollectionItem[],
  visit: (item: RequestItem, ancestors: FolderItem[]) => void,
  ancestors: FolderItem[] = [],
): void {
  for (const item of items) {
    if (item.type === "folder") walkRequests(item.items, visit, [...ancestors, item]);
    else visit(item, ancestors);
  }
}

export function findItem(
  collection: Collection,
  id: string,
): { item: CollectionItem; ancestors: FolderItem[] } | null {
  const search = (items: CollectionItem[], ancestors: FolderItem[]): { item: CollectionItem; ancestors: FolderItem[] } | null => {
    for (const item of items) {
      if (item.id === id) return { item, ancestors };
      if (item.type === "folder") {
        const found = search(item.items, [...ancestors, item]);
        if (found) return found;
      }
    }
    return null;
  };
  return search(collection.items, []);
}

/** Authentification effective : celle de la requête, ou la plus proche en remontant (dossiers, puis collection). */
export function resolveAuth(collection: Collection, item: RequestItem, ancestors: FolderItem[]): Auth {
  if (item.authMode === "own") return item.request.auth;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const auth = ancestors[i].auth;
    if (auth) return auth;
  }
  return collection.auth ?? { type: "none" };
}

/** Variables actives de la collection, surchargées par celles de l'environnement. */
export function mergeVariables(collection: Collection, environment?: Environment): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of collection.variables) if (v.enabled) out[v.key] = v.value;
  if (environment) for (const v of environment.variables) if (v.enabled) out[v.key] = v.value;
  return out;
}

export interface ResolvedRequest {
  id: string;
  name: string;
  /** La requête prête à être envoyée : authentification héritée résolue. */
  request: HttpRequest;
  variables: Record<string, string>;
  tests: Assertion[];
  extract: Extractor[];
  scripts: Scripts | undefined;
}

export function resolveRequest(collection: Collection, requestId: string, environment?: Environment): ResolvedRequest | null {
  const found = findItem(collection, requestId);
  if (!found || found.item.type !== "request") return null;
  const item = found.item;
  return {
    id: item.id,
    name: item.name,
    request: { ...item.request, auth: resolveAuth(collection, item, found.ancestors) },
    variables: mergeVariables(collection, environment),
    tests: item.tests,
    extract: item.extract,
    scripts: item.scripts,
  };
}

export interface WorkflowOptions {
  /** Ne garder que les requêtes de ce dossier (récursivement). */
  folderId?: string;
  environment?: Environment;
  /** Par défaut « continue », comme un collection runner : une assertion en échec n'arrête pas la suite. */
  onError?: "stop" | "continue";
}

const MAX_STEPS = 200;

/**
 * Transforme une collection (ou un dossier) en workflow : exécutable comme test fonctionnel,
 * ou comme scénario d'un test de charge. Les scripts pm.* ne sont pas exécutés côté serveur : ils sont signalés.
 */
export function collectionToWorkflow(
  collection: Collection,
  options: WorkflowOptions = {},
): { workflow: Workflow; warnings: string[] } {
  let items = collection.items;
  let base: FolderItem[] = [];
  let name = collection.name;

  if (options.folderId !== undefined) {
    const found = findItem(collection, options.folderId);
    if (!found || found.item.type !== "folder") {
      throw new CollectionError(`Dossier introuvable : ${options.folderId}`, options.folderId);
    }
    items = found.item.items;
    base = [...found.ancestors, found.item];
    name = `${collection.name} / ${found.item.name}`;
  }

  const warnings = new Warnings();
  const steps: unknown[] = [];

  walkRequests(items, (item, ancestors) => {
    const chain = [...base, ...ancestors];
    if (item.scripts?.preRequest || item.scripts?.test) {
      warnings.add(`« ${item.name} » : les scripts pm.* ne sont pas exécutés côté serveur (seuls les tests et extractions déclaratifs le sont).`);
    }
    steps.push({
      id: item.id,
      name: item.name,
      request: { ...item.request, auth: resolveAuth(collection, item, chain) },
      extract: item.extract,
      assertions: item.tests,
      onError: options.onError ?? "continue",
    });
  });

  if (steps.length === 0) throw new CollectionError("Aucune requête à exécuter dans cette sélection.");
  if (steps.length > MAX_STEPS) {
    throw new CollectionError(`Trop de requêtes pour un workflow (${steps.length}, maximum ${MAX_STEPS}) : sélectionne un dossier.`);
  }

  const workflow = WorkflowSchema.parse({
    name: name.slice(0, 200),
    variables: mergeVariables(collection, options.environment),
    steps,
  });
  return { workflow, warnings: warnings.toArray() };
}