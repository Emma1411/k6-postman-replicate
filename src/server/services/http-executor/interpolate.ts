import "server-only";
import type { HttpRequest, Variables } from "@/shared/schemas";

const VARIABLE_PATTERN = /\{\{\s*(\$?[A-Za-z_][A-Za-z0-9_.-]{0,127})\s*\}\}/g;
const SKIP_KEYS = new Set(["base64"]); // données binaires : jamais interpolées

export function interpolateString(text: string, variables: Variables, unresolved: Set<string>): string {
  // Une seule passe, avec une fonction de remplacement : pas de récursion, pas de motifs spéciaux ($&).
  return text.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
    unresolved.add(name);
    return match;
  });
}

export function interpolateRequest(
  request: HttpRequest,
  variables: Variables,
): { request: HttpRequest; unresolved: string[] } {
  const unresolved = new Set<string>();

  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") {
      return key && SKIP_KEYS.has(key) ? value : interpolateString(value, variables, unresolved);
    }
    if (Array.isArray(value)) return value.map((item) => walk(item));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    }
    return value;
  };

  return { request: walk(request) as HttpRequest, unresolved: [...unresolved] };
}