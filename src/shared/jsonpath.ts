export class JsonPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonPathError";
  }
}

export type Segment = { type: "key"; key: string } | { type: "index"; index: number } | { type: "wildcard" };

const cache = new Map<string, Segment[]>();
const CACHE_MAX = 500;

/**
 * Sous-ensemble de JSONPath : $  .clé  ['clé']  [n]  [-n]  [*]  .*
 * Non supporté : descente récursive (..), filtres [?()], tranches [a:b].
 */
export function parseJsonPath(path: string): Segment[] {
  const cached = cache.get(path);
  if (cached) return cached;

  if (!path.startsWith("$")) throw new JsonPathError('Le chemin doit commencer par "$".');
  const segments: Segment[] = [];
  let i = 1;

  while (i < path.length) {
    const ch = path[i];

    if (ch === ".") {
      if (path[i + 1] === ".") throw new JsonPathError('La descente récursive ".." n\'est pas supportée.');
      i++;
      if (path[i] === "*") {
        segments.push({ type: "wildcard" });
        i++;
        continue;
      }
      let j = i;
      while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
      const key = path.slice(i, j);
      if (!key) throw new JsonPathError(`Chemin invalide près de la position ${i}.`);
      segments.push({ type: "key", key });
      i = j;
    } else if (ch === "[") {
      i++;
      const quote = path[i];
      if (quote === "'" || quote === '"') {
        let j = i + 1;
        let key = "";
        while (j < path.length && path[j] !== quote) {
          if (path[j] === "\\" && j + 1 < path.length) {
            key += path[j + 1];
            j += 2;
          } else {
            key += path[j];
            j++;
          }
        }
        if (path[j] !== quote || path[j + 1] !== "]") throw new JsonPathError("Crochet ou guillemet non fermé.");
        segments.push({ type: "key", key });
        i = j + 2;
      } else {
        const end = path.indexOf("]", i);
        if (end === -1) throw new JsonPathError("Crochet non fermé.");
        const inner = path.slice(i, end).trim();
        if (inner === "*") segments.push({ type: "wildcard" });
        else if (/^-?\d+$/.test(inner)) segments.push({ type: "index", index: Number(inner) });
        else throw new JsonPathError(`Syntaxe non supportée entre crochets : [${inner}].`);
        i = end + 1;
      }
    } else {
      throw new JsonPathError(`Caractère inattendu "${ch}" à la position ${i}.`);
    }
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(path, segments);
  return segments;
}

const isObjectLike = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Renvoie toutes les valeurs trouvées (tableau vide si aucune). */
export function queryJsonPath(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];

  for (const segment of parseJsonPath(path)) {
    const next: unknown[] = [];
    for (const value of current) {
      if (segment.type === "key") {
        // hasOwnProperty : on n'accède jamais à __proto__ ni à constructor.
        if (isObjectLike(value) && Object.prototype.hasOwnProperty.call(value, segment.key)) {
          next.push(value[segment.key]);
        }
      } else if (segment.type === "index") {
        if (Array.isArray(value)) {
          const index = segment.index < 0 ? value.length + segment.index : segment.index;
          if (index >= 0 && index < value.length) next.push(value[index]);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) next.push(item);
      } else if (isObjectLike(value)) {
        for (const item of Object.values(value)) next.push(item);
      }
    }
    current = next;
    if (current.length === 0) break;
  }

  return current;
}