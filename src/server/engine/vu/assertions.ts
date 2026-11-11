import "server-only";
import type { Assertion, JsonPrimitive, Variables } from "@/shared/schemas";
import type { AssertionResult } from "@/shared/types/workflow-result";
import { interpolateString } from "@/server/services/http-executor/interpolate";
import { JsonPathError, queryJsonPath } from "./jsonpath";
import { JsonSchemaError, validateJsonSchema } from "./json-schema";
import { safeRegexExec } from "./safe-regex";
import type { ResponseView } from "./response-view";
import { previewValue, stringifyValue } from "./values";

type NumberOperator = "lt" | "lte" | "gt" | "gte";
const SYMBOLS: Record<NumberOperator, string> = { lt: "<", lte: "<=", gt: ">", gte: ">=" };
const JSON_TYPES = new Set(["string", "number", "boolean", "object", "array", "null"]);

function compare(operator: NumberOperator, actual: number, expected: number): boolean {
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "gt") return actual > expected;
  return actual >= expected;
}

/** Comparaison souple : le nombre 42 ou le booléen true sont égaux à "42" / "true". */
function looseEquals(actual: unknown, expected: JsonPrimitive): boolean {
  if (typeof expected === "string" && (typeof actual === "number" || typeof actual === "boolean")) {
    return String(actual) === expected;
  }
  return actual === expected;
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function resolve(text: string, variables: Variables): { text: string; missing: string[] } {
  const unresolved = new Set<string>();
  const out = interpolateString(text, variables, unresolved);
  return { text: out, missing: [...unresolved] };
}

export function describeAssertion(a: Assertion): string {
  switch (a.type) {
    case "status":
      return Array.isArray(a.expected) ? `Statut dans [${a.expected.join(", ")}]` : `Statut = ${a.expected}`;
    case "responseTime":
      return `Temps de réponse ${SYMBOLS[a.operator]} ${a.valueMs} ms`;
    case "header":
      return `Header ${a.headerName} ${a.operator}${a.value !== undefined ? ` ${a.value}` : ""}`;
    case "jsonPath":
      return `${a.path} ${a.operator}${a.value !== undefined ? ` ${JSON.stringify(a.value)}` : ""}`;
    case "bodyContains":
      return `Body contient "${a.value}"`;
    case "jsonSchema":
      return "Body conforme au schéma JSON";
  }
}

export function evaluateAssertion(assertion: Assertion, view: ResponseView, variables: Variables): AssertionResult {
  const label = assertion.label ?? describeAssertion(assertion);
  const pass = (): AssertionResult => ({ label, type: assertion.type, passed: true, message: null });
  const fail = (message: string): AssertionResult => ({ label, type: assertion.type, passed: false, message });

  try {
    return check(assertion, view, variables, pass, fail);
  } catch (err) {
    return fail(`Erreur d'évaluation : ${(err as Error).message}`);
  }
}

function check(
  a: Assertion,
  view: ResponseView,
  variables: Variables,
  pass: () => AssertionResult,
  fail: (message: string) => AssertionResult,
): AssertionResult {
  switch (a.type) {
    case "status": {
      const expected = Array.isArray(a.expected) ? a.expected : [a.expected];
      const actual = view.response.status;
      return expected.includes(actual) ? pass() : fail(`Statut attendu ${expected.join(" ou ")}, reçu ${actual}.`);
    }

    case "responseTime": {
      const actual = view.response.durationMs;
      return compare(a.operator, actual, a.valueMs)
        ? pass()
        : fail(`Temps de réponse ${actual} ms, attendu ${SYMBOLS[a.operator]} ${a.valueMs} ms.`);
    }

    case "header": {
      const values = view.headers(a.headerName);
      if (a.operator === "exists") return values.length > 0 ? pass() : fail(`Header ${a.headerName} absent.`);
      if (a.operator === "notExists") return values.length === 0 ? pass() : fail(`Header ${a.headerName} présent.`);
      if (a.value === undefined) return fail("Valeur attendue manquante.");

      const { text: expected, missing } = resolve(a.value, variables);
      if (missing.length > 0) return fail(`Variables non définies : ${missing.join(", ")}.`);
      if (values.length === 0) return fail(`Header ${a.headerName} absent.`);

      let ok: boolean;
      if (a.operator === "equals") {
        ok = values.some((v) => v === expected);
      } else if (a.operator === "contains") {
        ok = values.some((v) => v.includes(expected));
      } else {
        ok = false;
        for (const v of values) {
          const r = safeRegexExec(expected, v);
          if (!r.ok) return fail(r.error);
          if (r.match !== null) ok = true;
        }
      }
      return ok
        ? pass()
        : fail(`Header ${a.headerName} : ${JSON.stringify(values)}, attendu ${a.operator} ${JSON.stringify(expected)}.`);
    }

    case "bodyContains": {
      const text = view.response.bodyText;
      if (text === null) return fail("Le body est binaire.");
      const { text: expected, missing } = resolve(a.value, variables);
      if (missing.length > 0) return fail(`Variables non définies : ${missing.join(", ")}.`);
      return text.includes(expected) ? pass() : fail(`Le body ne contient pas ${JSON.stringify(expected)}.`);
    }

    case "jsonSchema": {
      const parsed = view.json();
      if (!parsed.ok) return fail(parsed.error);
      try {
        const issues = validateJsonSchema(parsed.value, a.schema);
        if (issues.length === 0) return pass();
        const shown = issues
          .slice(0, 3)
          .map((i) => `${i.path} : ${i.message}`)
          .join(" ; ");
        return fail(`${issues.length} écart(s) avec le schéma — ${shown}`);
      } catch (err) {
        if (err instanceof JsonSchemaError) return fail(`Schéma JSON invalide ou non supporté : ${err.message}`);
        throw err;
      }
    }

    case "jsonPath": {
      const parsed = view.json();
      if (!parsed.ok) return fail(parsed.error);

      let matches: unknown[];
      try {
        matches = queryJsonPath(parsed.value, a.path);
      } catch (err) {
        if (err instanceof JsonPathError) return fail(`Chemin JSONPath invalide : ${err.message}`);
        throw err;
      }
      const found = matches.length > 0;
      const actual = matches[0];

      if (a.operator === "exists") return found ? pass() : fail(`${a.path} introuvable.`);
      if (a.operator === "notExists") {
        return found ? fail(`${a.path} existe (valeur : ${previewValue(actual)}).`) : pass();
      }
      if (!found) return fail(`${a.path} introuvable.`);
      if (a.value === undefined) return fail("Valeur attendue manquante.");

      let expected: JsonPrimitive = a.value;
      if (typeof expected === "string") {
        const r = resolve(expected, variables);
        if (r.missing.length > 0) return fail(`Variables non définies : ${r.missing.join(", ")}.`);
        expected = r.text;
      }
      const got = `valeur : ${previewValue(actual)}`;

      switch (a.operator) {
        case "equals":
          return looseEquals(actual, expected) ? pass() : fail(`${a.path} : ${got}, attendu ${previewValue(expected)}.`);
        case "notEquals":
          return looseEquals(actual, expected) ? fail(`${a.path} : ${got}, valeur interdite.`) : pass();
        case "contains": {
          if (typeof actual === "string") {
            return actual.includes(String(expected)) ? pass() : fail(`${a.path} : ${got}, ne contient pas ${previewValue(expected)}.`);
          }
          if (Array.isArray(actual)) {
            return actual.some((item) => looseEquals(item, expected))
              ? pass()
              : fail(`${a.path} : ${got}, ne contient pas ${previewValue(expected)}.`);
          }
          return fail(`${a.path} : "contains" ne s'applique qu'aux chaînes et aux tableaux (${got}).`);
        }
        case "matches": {
          const r = safeRegexExec(String(expected), stringifyValue(actual));
          if (!r.ok) return fail(r.error);
          return r.match !== null ? pass() : fail(`${a.path} : ${got}, ne correspond pas à ${previewValue(expected)}.`);
        }
        case "gt":
        case "gte":
        case "lt":
        case "lte": {
          const left = typeof actual === "number" ? actual : Number(actual);
          const right = Number(expected);
          if (typeof actual === "object" || !Number.isFinite(left) || !Number.isFinite(right)) {
            return fail(`${a.path} : comparaison numérique impossible (${got}).`);
          }
          return compare(a.operator, left, right)
            ? pass()
            : fail(`${a.path} : ${left}, attendu ${SYMBOLS[a.operator]} ${right}.`);
        }
        case "type": {
          const wanted = String(expected);
          if (!JSON_TYPES.has(wanted)) return fail(`Type inconnu : ${wanted}.`);
          const actualType = jsonTypeOf(actual);
          return actualType === wanted ? pass() : fail(`${a.path} : type ${actualType}, attendu ${wanted}.`);
        }
        default:
          return fail(`Opérateur non géré : ${a.operator}.`);
      }
    }
  }
}