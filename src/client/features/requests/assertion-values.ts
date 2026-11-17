export type Primitive = string | number | boolean | null;

/**
 * Convertit le texte saisi en valeur JSON : 482 devient un nombre, true un booléen, null null.
 * Pour forcer une chaîne qui ressemble à un nombre, l'entourer de guillemets : "482".
 */
export function parsePrimitive(text: string): Primitive {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value as Primitive;
  } catch {
    /* pas du JSON : c'est du texte */
  }
  return text;
}

/** L'inverse de parsePrimitive : le texte à afficher pour qu'un aller-retour ne change rien. */
export function formatPrimitive(value: Primitive | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") {
    // Une chaîne qui serait relue comme un nombre, un booléen ou null s'affiche entre guillemets.
    return parsePrimitive(value) === value ? value : JSON.stringify(value);
  }
  return String(value);
}

/** « 200 » ou « 200, 201 » : un code, une liste de codes, ou null si le texte est invalide. */
export function parseStatusList(text: string): number | number[] | null {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 20) return null;
  const codes: number[] = [];
  for (const part of parts) {
    if (!/^\d{3}$/.test(part)) return null;
    const code = Number(part);
    if (code < 100 || code > 599) return null;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.length === 1 ? codes[0] : codes;
}

export const formatStatus = (expected: number | number[]): string =>
  Array.isArray(expected) ? expected.join(", ") : String(expected);