import "server-only";

/** Conversion d'une valeur JSON en texte, pour les variables. */
export function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Aperçu court d'une valeur, pour les messages d'erreur. */
export function previewValue(value: unknown, max = 80): string {
  const text = value === undefined ? "undefined" : (JSON.stringify(value) ?? String(value));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  return (
    keysA.length === Object.keys(objB).length &&
    keysA.every((k) => Object.prototype.hasOwnProperty.call(objB, k) && deepEqual(objA[k], objB[k]))
  );
}