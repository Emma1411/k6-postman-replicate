import "server-only";
import { parse as parseYaml } from "yaml";
import { AppError } from "@/server/utils/errors";

/**
 * Lit un texte JSON ou YAML. Le nombre d'alias YAML est limité (100) : sans cette borne, quelques lignes
 * suffiraient à produire une structure géante en mémoire (« billion laughs »).
 */
export function parseSpecText(content: string): unknown {
  const text = content.replace(/^\uFEFF/, "");

  try {
    return JSON.parse(text);
  } catch {
    /* ce n'est peut-être pas du JSON : on essaie le YAML */
  }

  try {
    return parseYaml(text, { maxAliasCount: 100 });
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] : "erreur inconnue";
    throw new AppError("VALIDATION_ERROR", `Le contenu n'est ni du JSON ni du YAML valide : ${reason}`);
  }
}