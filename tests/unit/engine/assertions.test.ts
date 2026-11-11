import { describe, it, expect } from "vitest";
import { evaluateAssertion } from "@/server/engine/vu/assertions";
import { ResponseView } from "@/server/engine/vu/response-view";
import type { StepResponse } from "@/server/engine/types";
import { AssertionSchema } from "@/shared/schemas";

const body = {
  id: 7,
  name: "emma",
  active: true,
  score: 4.5,
  tags: ["a", "b"],
  nested: { ok: null },
  email: "emma@example.com",
};

const response = (over: Partial<StepResponse> = {}): StepResponse => ({
  status: 200,
  headers: [
    { key: "Content-Type", value: "application/json" },
    { key: "Set-Cookie", value: "a=1" },
    { key: "Set-Cookie", value: "b=2" },
  ],
  bodyText: JSON.stringify(body),
  bodyBytes: 100,
  durationMs: 120,
  finalUrl: null,
  truncated: false,
  ...over,
});

const run = (assertion: unknown, res: StepResponse = response(), vars: Record<string, string> = {}) =>
  evaluateAssertion(AssertionSchema.parse(assertion), new ResponseView(res), vars);

const jp = (path: string, operator: string, value?: unknown) => ({ type: "jsonPath", path, operator, value });

describe("status et temps de réponse", () => {
  it("vérifie le statut", () => {
    expect(run({ type: "status", expected: 200 }).passed).toBe(true);
    expect(run({ type: "status", expected: [200, 201] }).passed).toBe(true);
    const r = run({ type: "status", expected: 404 });
    expect(r.passed).toBe(false);
    expect(r.message).toContain("404");
    expect(r.message).toContain("200");
  });

  it("vérifie le temps de réponse", () => {
    expect(run({ type: "responseTime", operator: "lt", valueMs: 200 }).passed).toBe(true);
    expect(run({ type: "responseTime", operator: "lt", valueMs: 100 }).passed).toBe(false);
  });
});

describe("headers", () => {
  it("ignore la casse du nom", () => {
    expect(run({ type: "header", headerName: "content-type", operator: "exists" }).passed).toBe(true);
    expect(run({ type: "header", headerName: "x-nope", operator: "notExists" }).passed).toBe(true);
    expect(run({ type: "header", headerName: "x-nope", operator: "exists" }).passed).toBe(false);
  });

  it("compare les valeurs", () => {
    const h = (operator: string, value: string) => ({ type: "header", headerName: "Content-Type", operator, value });
    expect(run(h("equals", "application/json")).passed).toBe(true);
    expect(run(h("contains", "json")).passed).toBe(true);
    expect(run(h("matches", "^application/(json|xml)$")).passed).toBe(true);
    expect(run(h("equals", "text/html")).passed).toBe(false);
  });

  it("teste chaque valeur d'un header répété", () => {
    expect(run({ type: "header", headerName: "set-cookie", operator: "equals", value: "b=2" }).passed).toBe(true);
  });
});

describe("jsonPath", () => {
  it("exists / notExists", () => {
    expect(run(jp("$.id", "exists")).passed).toBe(true);
    expect(run(jp("$.zzz", "notExists")).passed).toBe(true);
    expect(run(jp("$.zzz", "exists")).passed).toBe(false);
    expect(run(jp("$.id", "notExists")).passed).toBe(false);
  });

  it("equals compare de façon souple chaîne et nombre", () => {
    expect(run(jp("$.id", "equals", 7)).passed).toBe(true);
    expect(run(jp("$.id", "equals", "7")).passed).toBe(true);
    expect(run(jp("$.active", "equals", "true")).passed).toBe(true);
    expect(run(jp("$.name", "equals", "emma")).passed).toBe(true);
    expect(run(jp("$.name", "equals", "bob")).passed).toBe(false);
    expect(run(jp("$.name", "notEquals", "bob")).passed).toBe(true);
  });

  it("contains, matches et comparaisons", () => {
    expect(run(jp("$.name", "contains", "mm")).passed).toBe(true);
    expect(run(jp("$.tags", "contains", "b")).passed).toBe(true);
    expect(run(jp("$.tags", "contains", "z")).passed).toBe(false);
    expect(run(jp("$.email", "matches", "^[^@]+@example\\.com$")).passed).toBe(true);
    expect(run(jp("$.score", "gt", 4)).passed).toBe(true);
    expect(run(jp("$.score", "lte", 4)).passed).toBe(false);
  });

  it("vérifie le type", () => {
    expect(run(jp("$.id", "type", "number")).passed).toBe(true);
    expect(run(jp("$.tags", "type", "array")).passed).toBe(true);
    expect(run(jp("$.nested.ok", "type", "null")).passed).toBe(true);
    expect(run(jp("$.id", "type", "string")).passed).toBe(false);
  });

  it("interpole les variables dans la valeur attendue", () => {
    expect(run(jp("$.name", "equals", "{{who}}"), response(), { who: "emma" }).passed).toBe(true);
    const r = run(jp("$.name", "equals", "{{nope}}"));
    expect(r.passed).toBe(false);
    expect(r.message).toContain("Variables non définies");
  });

  it("échoue clairement sur un body non JSON ou un chemin invalide", () => {
    const notJson = run(jp("$.id", "exists"), response({ bodyText: "<html>" }));
    expect(notJson.passed).toBe(false);
    expect(notJson.message).toContain("JSON");

    const badPath = run(jp("$..id", "exists"));
    expect(badPath.passed).toBe(false);
    expect(badPath.message).toContain("JSONPath");
  });
});

describe("bodyContains et jsonSchema", () => {
  it("vérifie le contenu du body", () => {
    expect(run({ type: "bodyContains", value: "emma" }).passed).toBe(true);
    expect(run({ type: "bodyContains", value: "zzz" }).passed).toBe(false);
  });

  it("valide la structure JSON", () => {
    const ok = { type: "jsonSchema", schema: { type: "object", required: ["id"], properties: { id: { type: "integer" } } } };
    expect(run(ok).passed).toBe(true);

    const ko = { type: "jsonSchema", schema: { type: "object", properties: { id: { type: "string" } } } };
    const r = run(ko);
    expect(r.passed).toBe(false);
    expect(r.message).toContain("$.id");

    const unsupported = run({ type: "jsonSchema", schema: { pattern: "x" } });
    expect(unsupported.passed).toBe(false);
    expect(unsupported.message).toContain("non supporté");
  });
});

describe("libellés", () => {
  it("génère un libellé par défaut et accepte un libellé personnalisé", () => {
    expect(run({ type: "status", expected: 200 }).label).toBe("Statut = 200");
    expect(run({ type: "status", expected: 200, label: "OK attendu" }).label).toBe("OK attendu");
  });
});