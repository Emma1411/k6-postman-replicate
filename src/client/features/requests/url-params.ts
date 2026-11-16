import type { KeyValue } from "@/shared/schemas";

const HAS_VARIABLE = /\{\{[^}]*\}\}/;

// Une valeur contenant {{variable}} reste telle quelle : l'encoder casserait la variable.
const encode = (s: string) => (HAS_VARIABLE.test(s) ? s : encodeURIComponent(s));

function decode(s: string): string {
  if (HAS_VARIABLE.test(s)) return s;
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function split(url: string): { base: string; query: string; hash: string } {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const q = withoutHash.indexOf("?");
  return q === -1
    ? { base: withoutHash, query: "", hash }
    : { base: withoutHash.slice(0, q), query: withoutHash.slice(q + 1), hash };
}

/** Les paramètres présents dans l'URL, tous actifs. */
export function parseQuery(url: string): KeyValue[] {
  const { query } = split(url);
  if (!query) return [];
  return query
    .split("&")
    .filter((segment) => segment !== "")
    .map((segment) => {
      const eq = segment.indexOf("=");
      const key = eq === -1 ? segment : segment.slice(0, eq);
      const value = eq === -1 ? "" : segment.slice(eq + 1);
      return { key: decode(key), value: decode(value), enabled: true };
    });
}

/** Réécrit la requête de l'URL à partir du tableau : seules les lignes actives y figurent. */
export function applyParams(url: string, params: KeyValue[]): string {
  const { base, hash } = split(url);
  const query = params
    .filter((p) => p.enabled && p.key !== "")
    .map((p) => `${encode(p.key)}=${encode(p.value)}`)
    .join("&");
  return `${base}${query ? `?${query}` : ""}${hash}`;
}

/** Quand l'URL est modifiée : les paramètres de l'URL, plus les lignes désactivées déjà présentes. */
export function mergeParamsFromUrl(url: string, previous: KeyValue[]): KeyValue[] {
  return [...parseQuery(url), ...previous.filter((p) => !p.enabled)];
}