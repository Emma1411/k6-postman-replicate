import { z } from "zod";
import { VariableNameSchema } from "./common";
import { AuthSchema, HttpRequestSchema, type Auth } from "./http";
import { AssertionSchema, ExtractorSchema } from "./workflow";

export const COLLECTION_FORMAT = "api-engineering-platform/collection" as const;
export const ENVIRONMENT_FORMAT = "api-engineering-platform/environment" as const;
export const COLLECTION_LIMITS = { maxDepth: 20, maxRequests: 5000 } as const;

/** Collection ou environnement invalide, ou import impossible. `path` situe l'élément fautif. */
export class CollectionError extends Error {
  readonly path: string;
  constructor(message: string, path = "") {
    super(message);
    this.name = "CollectionError";
    this.path = path;
  }
}

export const newId = (): string => globalThis.crypto.randomUUID();

export const ItemIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Identifiant invalide (lettres, chiffres, - et _, 64 caractères maximum).");

export const VariableEntrySchema = z.object({
  key: VariableNameSchema,
  value: z.string().max(16_384),
  enabled: z.boolean().default(true),
  secret: z.boolean().default(false),
});
export type VariableEntry = z.output<typeof VariableEntrySchema>;

/** Scripts de style Postman (pm.*), conservés pour le bac à sable du client : jamais exécutés côté serveur. */
export const ScriptsSchema = z.object({
  preRequest: z.string().max(100_000).optional(),
  test: z.string().max(100_000).optional(),
});
export type Scripts = z.output<typeof ScriptsSchema>;

const RequestNodeSchema = z.object({
  type: z.literal("request"),
  id: ItemIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  request: HttpRequestSchema,
  /** inherit : utilise l'authentification du dossier parent, puis de la collection. own : request.auth. */
  authMode: z.enum(["inherit", "own"]).default("own"),
  /** Assertions déclaratives, exécutables par le moteur. */
  tests: z.array(AssertionSchema).max(50).default([]),
  extract: z.array(ExtractorSchema).max(50).default([]),
  scripts: ScriptsSchema.optional(),
});
export type RequestItem = z.output<typeof RequestNodeSchema>;

const FolderNodeSchema = z.object({
  type: z.literal("folder"),
  id: ItemIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  auth: AuthSchema.optional(),
  scripts: ScriptsSchema.optional(),
  items: z.array(z.unknown()).max(COLLECTION_LIMITS.maxRequests),
});

export interface FolderItem {
  type: "folder";
  id: string;
  name: string;
  description?: string;
  auth?: Auth;
  scripts?: Scripts;
  items: CollectionItem[];
}
export type CollectionItem = FolderItem | RequestItem;

const CollectionDocSchema = z.object({
  format: z.literal(COLLECTION_FORMAT),
  version: z.literal(1),
  id: ItemIdSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  variables: z.array(VariableEntrySchema).max(500).default([]),
  auth: AuthSchema.optional(),
  scripts: ScriptsSchema.optional(),
  items: z.array(z.unknown()).max(COLLECTION_LIMITS.maxRequests),
});

export interface Collection {
  format: typeof COLLECTION_FORMAT;
  version: 1;
  id: string;
  name: string;
  description?: string;
  variables: VariableEntry[];
  auth?: Auth;
  scripts?: Scripts;
  items: CollectionItem[];
}

export const EnvironmentSchema = z.object({
  format: z.literal(ENVIRONMENT_FORMAT),
  version: z.literal(1),
  id: ItemIdSchema,
  name: z.string().min(1).max(200),
  variables: z.array(VariableEntrySchema).max(1000),
});
export type Environment = z.output<typeof EnvironmentSchema>;

export const ImportInputSchema = z.object({
  source: z.enum(["postman-collection", "postman-environment"]),
  /** Le contenu du fichier : texte JSON, ou objet déjà analysé. */
  content: z.union([z.string().min(2), z.record(z.string(), z.unknown())]),
});
export type ImportInput = z.output<typeof ImportInputSchema>;

function parseWith<S extends z.ZodType>(schema: S, value: unknown, path: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = [path, ...issue.path.map(String)].filter(Boolean).join(".");
    throw new CollectionError(issue.message, where);
  }
  return result.data as z.output<S>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface ParseState {
  requests: number;
  ids: Set<string>;
}

function parseItems(raw: unknown[], depth: number, path: string, state: ParseState): CollectionItem[] {
  if (depth > COLLECTION_LIMITS.maxDepth) {
    throw new CollectionError(`Dossiers imbriqués sur plus de ${COLLECTION_LIMITS.maxDepth} niveaux.`, path);
  }

  return raw.map((node, i) => {
    const at = `${path}[${i}]`;
    const type = isRecord(node) ? node.type : undefined;
    let item: CollectionItem;

    if (type === "folder") {
      const folder = parseWith(FolderNodeSchema, node, at);
      item = { ...folder, items: parseItems(folder.items, depth + 1, `${at}.items`, state) };
    } else if (type === "request") {
      item = parseWith(RequestNodeSchema, node, at);
      state.requests++;
      if (state.requests > COLLECTION_LIMITS.maxRequests) {
        throw new CollectionError(`Trop de requêtes (maximum ${COLLECTION_LIMITS.maxRequests}).`, at);
      }
    } else {
      throw new CollectionError('Élément inconnu : « type » doit valoir "folder" ou "request".', at);
    }

    if (state.ids.has(item.id)) throw new CollectionError(`Identifiant dupliqué : ${item.id}`, at);
    state.ids.add(item.id);
    return item;
  });
}

/** Valide une collection (et applique les valeurs par défaut) ; lève CollectionError avec le chemin de l'erreur. */
export function parseCollection(input: unknown): Collection {
  const doc = parseWith(CollectionDocSchema, input, "");
  const items = parseItems(doc.items, 1, "items", { requests: 0, ids: new Set() });
  return { ...doc, items };
}

export function parseEnvironment(input: unknown): Environment {
  return parseWith(EnvironmentSchema, input, "");
}