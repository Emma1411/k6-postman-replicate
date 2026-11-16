import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/server/config/env.schema";
import { buildLimits } from "@/server/config/limits";
import { executeWithAssertions } from "@/server/services/http-executor/with-assertions";
import { SendRequestInputSchema, type HttpResponse } from "@/shared/schemas";

const limits = buildLimits(parseEnv({}));

function response(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: [
      { key: "Content-Type", value: "application/json" },
      { key: "X-Total", value: "482" },
    ],
    body: {
      encoding: "utf8",
      content: JSON.stringify({ meta: { total_count: 482 }, items: [{ id: "p1" }] }),
      truncated: false,
    },
    sizeBytes: 64,
    timings: { dnsMs: 4, connectMs: 12, tlsMs: 18, ttfbMs: 32, transferMs: 5, totalMs: 71 },
    redirects: [],
    finalUrl: "https://api.exemple.com/v1/products",
    ...overrides,
  };
}

const input = (assertions: unknown[]) =>
  SendRequestInputSchema.parse({
    request: { method: "GET", url: "https://api.exemple.com/v1/products" },
    assertions,
  });

const run = (assertions: unknown[], res: HttpResponse = response()) => {
  const execute = vi.fn(async () => res);
  return { execute, result: executeWithAssertions(input(assertions), { limits, execute }) };
};

describe("executeWithAssertions", () => {
  it("sans assertion, renvoie la réponse telle quelle avec une liste vide", async () => {
    const { result } = run([]);
    const out = await result;
    expect(out.status).toBe(200);
    expect(out.timings.totalMs).toBe(71);
    expect(out.assertions).toEqual([]);
  });

  it("n'envoie qu'une requête à la cible et sans les assertions", async () => {
    const { execute, result } = run([{ type: "status", expected: 200 }]);
    await result;
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      { request: expect.objectContaining({ method: "GET" }), variables: {} },
      { limits },
    );
  });

  it("valide les assertions satisfaites", async () => {
    const { result } = run([
      { type: "status", expected: 200 },
      { type: "responseTime", operator: "lt", valueMs: 200 },
      { type: "header", headerName: "x-total", operator: "equals", value: "482" },
      { type: "jsonPath", path: "$.meta.total_count", operator: "equals", value: 482 },
      { type: "bodyContains", value: "p1" },
    ]);
    const out = await result;
    expect(out.assertions).toHaveLength(5);
    expect(out.assertions.every((a) => a.passed)).toBe(true);
  });

  it("signale les assertions échouées avec un message", async () => {
    const { result } = run([
      { type: "status", expected: 201 },
      { type: "responseTime", operator: "lt", valueMs: 50 },
      { type: "jsonPath", path: "$.absent", operator: "exists" },
    ]);
    const out = await result;
    expect(out.assertions.map((a) => a.passed)).toEqual([false, false, false]);
    for (const a of out.assertions) expect(a.message).toBeTruthy();
  });

  it("fait échouer une assertion JSON sur un corps binaire ou tronqué", async () => {
    const jsonAssertion = [{ type: "jsonPath", path: "$.meta", operator: "exists" }];
    const binary = await run(jsonAssertion, response({ body: { encoding: "base64", content: "AAA=", truncated: false } })).result;
    const truncated = await run(jsonAssertion, response({ body: { encoding: "utf8", content: "{", truncated: true } })).result;
    expect(binary.assertions[0].passed).toBe(false);
    expect(truncated.assertions[0].passed).toBe(false);
  });
});

describe("SendRequestInputSchema", () => {
  it("accepte une requête sans assertion", () => {
    const parsed = SendRequestInputSchema.parse({ request: { method: "GET", url: "https://x.test" } });
    expect(parsed.assertions).toEqual([]);
    expect(parsed.variables).toEqual({});
  });

  it("refuse plus de 50 assertions", () => {
    const many = Array.from({ length: 51 }, () => ({ type: "status", expected: 200 }));
    expect(SendRequestInputSchema.safeParse({ request: { method: "GET", url: "https://x.test" }, assertions: many }).success).toBe(false);
  });
});