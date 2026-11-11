import { describe, it, expect } from "vitest";
import { JsonSchemaError, validateJsonSchema } from "@/server/engine/vu/json-schema";

const schema = {
  type: "object",
  required: ["id", "name"],
  properties: {
    id: { type: "integer" },
    name: { type: "string", minLength: 1 },
    tags: { type: "array", items: { type: "string" }, maxItems: 2 },
  },
  additionalProperties: false,
};

describe("validateJsonSchema", () => {
  it("accepte une valeur conforme", () => {
    expect(validateJsonSchema({ id: 1, name: "a", tags: ["x"] }, schema)).toEqual([]);
  });

  it("liste les écarts avec leur chemin", () => {
    const issues = validateJsonSchema({ id: "1", tags: ["x", 2, "z"], extra: true }, schema);
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("$.id");
    expect(paths).toContain("$.tags");
    expect(paths).toContain("$.tags[1]");
    expect(paths).toContain("$.extra");
    expect(issues.some((i) => i.message.includes("name"))).toBe(true);
  });

  it("distingue integer et number", () => {
    expect(validateJsonSchema(1.5, { type: "number" })).toEqual([]);
    expect(validateJsonSchema(1.5, { type: "integer" })).toHaveLength(1);
  });

  it("gère type multiple, enum, const et bornes", () => {
    expect(validateJsonSchema(null, { type: ["string", "null"] })).toEqual([]);
    expect(validateJsonSchema("c", { enum: ["a", "b"] })).toHaveLength(1);
    expect(validateJsonSchema({ a: 1 }, { const: { a: 1 } })).toEqual([]);
    expect(validateJsonSchema(5, { minimum: 10 })).toHaveLength(1);
    expect(validateJsonSchema("abcd", { maxLength: 3 })).toHaveLength(1);
    expect(validateJsonSchema([1], { minItems: 2 })).toHaveLength(1);
  });

  it("valide additionalProperties sous forme de schéma", () => {
    const s = { type: "object", additionalProperties: { type: "number" } };
    expect(validateJsonSchema({ a: 1, b: 2 }, s)).toEqual([]);
    expect(validateJsonSchema({ a: "x" }, s)).toHaveLength(1);
  });

  it("limite le nombre d'écarts", () => {
    const issues = validateJsonSchema(Array(50).fill(1), { items: { type: "string" } }, 5);
    expect(issues).toHaveLength(5);
  });

  it("rejette explicitement les mots-clés non supportés", () => {
    expect(() => validateJsonSchema("a", { pattern: "^a$" })).toThrow(JsonSchemaError);
    expect(() => validateJsonSchema("a", { oneOf: [] })).toThrow(JsonSchemaError);
    expect(() => validateJsonSchema("a", { type: "texte" })).toThrow(JsonSchemaError);
  });
});