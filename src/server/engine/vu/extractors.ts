import "server-only";
import type { Extractor } from "@/shared/schemas";
import { JsonPathError, queryJsonPath } from "./jsonpath";
import { safeRegexExec } from "./safe-regex";
import type { ResponseView } from "./response-view";
import { stringifyValue } from "./values";

export interface ExtractionOutcome {
  values: Record<string, string>;
  errors: string[];
}

const MAX_VALUE_CHARS = 16_384; // même plafond que les variables du schéma

function extractOne(extractor: Extractor, view: ResponseView): { ok: true; value: string } | { ok: false; error: string } {
  switch (extractor.from) {
    case "status":
      return { ok: true, value: String(view.response.status) };

    case "header": {
      const value = view.header(extractor.headerName);
      return value === null
        ? { ok: false, error: `header ${extractor.headerName} absent` }
        : { ok: true, value };
    }

    case "jsonPath": {
      const parsed = view.json();
      if (!parsed.ok) return { ok: false, error: parsed.error };
      try {
        const matches = queryJsonPath(parsed.value, extractor.path);
        return matches.length === 0
          ? { ok: false, error: `aucune valeur trouvée pour ${extractor.path}` }
          : { ok: true, value: stringifyValue(matches[0]) };
      } catch (err) {
        if (err instanceof JsonPathError) return { ok: false, error: `chemin JSONPath invalide : ${err.message}` };
        throw err;
      }
    }

    case "regex": {
      const text = view.response.bodyText;
      if (text === null) return { ok: false, error: "le body est binaire" };
      const result = safeRegexExec(extractor.pattern, text);
      if (!result.ok) return { ok: false, error: result.error };
      if (result.match === null) return { ok: false, error: "aucune correspondance pour l'expression régulière" };
      const group = result.match[extractor.group];
      return group === undefined || group === null
        ? { ok: false, error: `le groupe ${extractor.group} est absent de la correspondance` }
        : { ok: true, value: group };
    }
  }
}

export function applyExtractors(extractors: Extractor[], view: ResponseView): ExtractionOutcome {
  const values: Record<string, string> = {};
  const errors: string[] = [];

  for (const extractor of extractors) {
    const result = extractOne(extractor, view);
    if (!result.ok) {
      errors.push(`${extractor.variable} : ${result.error}`);
    } else if (result.value.length > MAX_VALUE_CHARS) {
      errors.push(`${extractor.variable} : valeur trop longue (${result.value.length} > ${MAX_VALUE_CHARS} caractères)`);
    } else {
      values[extractor.variable] = result.value;
    }
  }
  return { values, errors };
}