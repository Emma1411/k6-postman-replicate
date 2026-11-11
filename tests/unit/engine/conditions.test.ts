import { describe, it, expect } from "vitest";
import { evaluateCondition } from "@/server/engine/vu/conditions";
import { ConditionSchema } from "@/shared/schemas";

const check = (condition: unknown, vars: Record<string, string> = {}) =>
  evaluateCondition(ConditionSchema.parse(condition), vars);

describe("evaluateCondition", () => {
  it("exists / notExists", () => {
    expect(check({ left: "{{a}}", operator: "exists" }, { a: "x" })).toBe(true);
    expect(check({ left: "{{a}}", operator: "exists" }, { a: "" })).toBe(false);
    expect(check({ left: "{{a}}", operator: "notExists" }, { a: "" })).toBe(true);
  });

  it("variable non définie : exists faux, notExists vrai, le reste faux", () => {
    expect(check({ left: "{{nope}}", operator: "exists" })).toBe(false);
    expect(check({ left: "{{nope}}", operator: "notExists" })).toBe(true);
    expect(check({ left: "{{nope}}", operator: "equals", right: "x" })).toBe(false);
    expect(check({ left: "{{nope}}", operator: "notEquals", right: "x" })).toBe(false);
  });

  it("equals / notEquals / contains", () => {
    expect(check({ left: "{{role}}", operator: "equals", right: "admin" }, { role: "admin" })).toBe(true);
    expect(check({ left: "{{role}}", operator: "notEquals", right: "admin" }, { role: "user" })).toBe(true);
    expect(check({ left: "{{p}}", operator: "contains", right: "ab" }, { p: "xaby" })).toBe(true);
  });

  it("comparaisons numériques", () => {
    expect(check({ left: "{{n}}", operator: "gt", right: "5" }, { n: "10" })).toBe(true);
    expect(check({ left: "{{n}}", operator: "lte", right: "5" }, { n: "5" })).toBe(true);
    expect(check({ left: "{{n}}", operator: "lt", right: "5" }, { n: "abc" })).toBe(false);
    expect(check({ left: "{{n}}", operator: "gte", right: "" }, { n: "5" })).toBe(false);
  });
});