import { describe, it, expect } from "vitest";
import { applyExtractors } from "@/server/engine/vu/extractors";
import { ResponseView } from "@/server/engine/vu/response-view";
import type { StepResponse } from "@/server/engine/types";
import { ExtractorSchema } from "@/shared/schemas";

const response = (over: Partial<StepResponse> = {}): StepResponse => ({
  status: 201,
  headers: [{ key: "Location", value: "/users/7" }],
  bodyText: JSON.stringify({ id: 7, user: { name: "emma" }, tags: ["a"], ok: true, nothing: null }),
  bodyBytes: 10,
  durationMs: 5,
  finalUrl: null,
  truncated: false,
  ...over,
});

const extract = (extractors: unknown[], res = response()) =>
  applyExtractors(extractors.map((e) => ExtractorSchema.parse(e)), new ResponseView(res));

describe("applyExtractors", () => {
  it("extrait depuis JSONPath avec conversion en texte", () => {
    const out = extract([
      { variable: "id", from: "jsonPath", path: "$.id" },
      { variable: "user", from: "jsonPath", path: "$.user" },
      { variable: "ok", from: "jsonPath", path: "$.ok" },
      { variable: "nothing", from: "jsonPath", path: "$.nothing" },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.values).toEqual({ id: "7", user: '{"name":"emma"}', ok: "true", nothing: "null" });
  });

  it("extrait un header, le statut et un groupe de regex", () => {
    const out = extract([
      { variable: "loc", from: "header", headerName: "location" },
      { variable: "code", from: "status" },
      { variable: "uid", from: "regex", pattern: '"id":(\\d+)' },
      { variable: "whole", from: "regex", pattern: "emma", group: 0 },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.values).toEqual({ loc: "/users/7", code: "201", uid: "7", whole: "emma" });
  });

  it("signale chaque échec sans bloquer les autres extractions", () => {
    const out = extract([
      { variable: "a", from: "jsonPath", path: "$.nope" },
      { variable: "b", from: "header", headerName: "x-nope" },
      { variable: "c", from: "regex", pattern: "zzz" },
      { variable: "d", from: "regex", pattern: "(", group: 0 },
      { variable: "e", from: "regex", pattern: "id", group: 3 },
      { variable: "ok", from: "status" },
    ]);
    expect(out.errors).toHaveLength(5);
    expect(out.values).toEqual({ ok: "201" });
  });

  it("refuse une valeur trop longue", () => {
    const out = extract(
      [{ variable: "big", from: "jsonPath", path: "$.s" }],
      response({ bodyText: JSON.stringify({ s: "x".repeat(20_000) }) }),
    );
    expect(out.values).toEqual({});
    expect(out.errors[0]).toContain("trop longue");
  });

  it("signale un body non JSON", () => {
    const out = extract([{ variable: "a", from: "jsonPath", path: "$.id" }], response({ bodyText: "pas du json" }));
    expect(out.errors[0]).toContain("JSON");
  });
});