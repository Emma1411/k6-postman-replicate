import { describe, it, expect } from "vitest";
import { z } from "zod";
import { limits } from "@/server/config";
import { withApi } from "@/server/middlewares/with-api";

const route = withApi({ schema: z.object({ n: z.number() }) }, async (input) =>
  Response.json({ double: input.n * 2 }),
);

const call = (body: unknown, ip: string) =>
  route(
    new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "x-forwarded-for": ip, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("withApi", () => {
  it("exécute le handler avec l'entrée validée", async () => {
    const res = await call({ n: 21 }, "203.0.113.10");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ double: 42 });
  });

  it("renvoie 400 pour un JSON invalide", async () => {
    const res = await call("{pas du json", "203.0.113.11");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("renvoie 400 avec le détail quand le schéma n'est pas respecté", async () => {
    const res = await call({ n: "x" }, "203.0.113.12");
    expect(res.status).toBe(400);
    expect((await res.json()).error.details.issues[0].path).toBe("n");
  });

  it("renvoie 429 avec Retry-After au-delà du quota", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < limits.rateLimit.maxRequests; i++) {
      expect((await call({ n: 1 }, ip)).status).toBe(200);
    }
    const res = await call({ n: 1 }, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });
});