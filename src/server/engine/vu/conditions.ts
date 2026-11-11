import "server-only";
import type { Condition, Variables } from "@/shared/schemas";
import { interpolateString } from "@/server/services/http-executor/interpolate";

/**
 * Évalue une condition d'exécution. Si une variable utilisée n'est pas définie :
 * exists → faux, notExists → vrai, tous les autres opérateurs → faux.
 */
export function evaluateCondition(condition: Condition, variables: Variables): boolean {
  const unresolved = new Set<string>();
  const left = interpolateString(condition.left, variables, unresolved);
  const right = interpolateString(condition.right ?? "", variables, unresolved);
  if (unresolved.size > 0) return condition.operator === "notExists";

  switch (condition.operator) {
    case "exists":
      return left.trim() !== "";
    case "notExists":
      return left.trim() === "";
    case "equals":
      return left === right;
    case "notEquals":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (left.trim() === "" || right.trim() === "") return false;
      const a = Number(left);
      const b = Number(right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (condition.operator === "gt") return a > b;
      if (condition.operator === "gte") return a >= b;
      if (condition.operator === "lt") return a < b;
      return a <= b;
    }
  }
}