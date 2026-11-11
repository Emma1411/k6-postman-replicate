import "server-only";
import { deepEqual } from "./values";

export class JsonSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonSchemaError";
  }
}

export interface SchemaIssue {
  path: string;
  message: string;
}

// Sous-ensemble volontaire : pas de pattern, format, $ref, oneOf/anyOf/allOf (voir les notes).
const SUPPORTED = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "additionalProperties",
  "description",
  "title",
  "default",
  "examples",
  "$schema",
  "$id",
]);
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const MAX_DEPTH = 32;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeOf(value) === type;
}

function numberKeyword(schema: Record<string, unknown>, key: string): number | undefined {
  const v = schema[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new JsonSchemaError(`"${key}" doit être un nombre.`);
  return v;
}

function validate(value: unknown, schema: unknown, path: string, issues: SchemaIssue[], max: number, depth: number): void {
  if (issues.length >= max) return;
  if (depth > MAX_DEPTH) throw new JsonSchemaError("Schéma trop profond.");
  if (!isPlainObject(schema)) throw new JsonSchemaError(`Le schéma à ${path} doit être un objet.`);

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new JsonSchemaError(`Mot-clé non supporté : "${key}".`);
  }
  const add = (message: string) => {
    if (issues.length < max) issues.push({ path, message });
  };

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (typeof t !== "string" || !TYPES.has(t)) throw new JsonSchemaError(`Type inconnu : ${JSON.stringify(t)}.`);
    }
    if (!types.some((t) => matchesType(value, t as string))) {
      add(`type ${typeOf(value)} reçu, attendu ${types.join(" ou ")}`);
      return; // les autres contrôles n'ont plus de sens
    }
  }

  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum)) throw new JsonSchemaError('"enum" doit être un tableau.');
    if (!schema.enum.some((candidate) => deepEqual(candidate, value))) add("valeur absente de la liste autorisée (enum)");
  }
  if ("const" in schema && !deepEqual(schema.const, value)) add("valeur différente de la constante attendue");

  if (typeof value === "number") {
    const min = numberKeyword(schema, "minimum");
    const maxV = numberKeyword(schema, "maximum");
    if (min !== undefined && value < min) add(`${value} < minimum ${min}`);
    if (maxV !== undefined && value > maxV) add(`${value} > maximum ${maxV}`);
  }

  if (typeof value === "string") {
    const length = [...value].length;
    const min = numberKeyword(schema, "minLength");
    const maxL = numberKeyword(schema, "maxLength");
    if (min !== undefined && length < min) add(`longueur ${length} < minLength ${min}`);
    if (maxL !== undefined && length > maxL) add(`longueur ${length} > maxLength ${maxL}`);
  }

  if (Array.isArray(value)) {
    const min = numberKeyword(schema, "minItems");
    const maxI = numberKeyword(schema, "maxItems");
    if (min !== undefined && value.length < min) add(`${value.length} élément(s) < minItems ${min}`);
    if (maxI !== undefined && value.length > maxI) add(`${value.length} élément(s) > maxItems ${maxI}`);
    if (schema.items !== undefined) {
      value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`, issues, max, depth + 1));
    }
  }

  if (isPlainObject(value)) {
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required)) throw new JsonSchemaError('"required" doit être un tableau.');
      for (const name of schema.required) {
        if (typeof name === "string" && !Object.prototype.hasOwnProperty.call(value, name)) {
          add(`propriété requise manquante : ${name}`);
        }
      }
    }
    const properties = schema.properties;
    if (properties !== undefined && !isPlainObject(properties)) throw new JsonSchemaError('"properties" doit être un objet.');
    for (const [name, sub] of Object.entries(properties ?? {})) {
      if (Object.prototype.hasOwnProperty.call(value, name)) {
        validate(value[name], sub, `${path}.${name}`, issues, max, depth + 1);
      }
    }
    const additional = schema.additionalProperties;
    if (additional !== undefined) {
      const declared = new Set(Object.keys(properties ?? {}));
      for (const name of Object.keys(value)) {
        if (declared.has(name)) continue;
        if (additional === false) {
          if (issues.length < max) issues.push({ path: `${path}.${name}`, message: "propriété non autorisée" });
        } else if (additional !== true) {
          validate(value[name], additional, `${path}.${name}`, issues, max, depth + 1);
        }
      }
    }
  }
}

/** Renvoie la liste des écarts (vide si la valeur est conforme). Lève JsonSchemaError si le schéma est invalide ou non supporté. */
export function validateJsonSchema(value: unknown, schema: unknown, maxIssues = 10): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  validate(value, schema, "$", issues, maxIssues, 0);
  return issues;
}