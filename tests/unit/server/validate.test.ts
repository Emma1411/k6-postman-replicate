import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseInput, readJsonBody } from "@/server/middlewares/validate";

const post = (body: string) => new Request("http://localhost/api/x", { method: "POST", body });

describe("readJsonBody", () => {
  it("lit un JSON valide", async () => {
    await expect(readJsonBody(post('{"a":1}'), 1024)).resolves.toEqual({ a: 1 });
  });

  it("refuse un body trop volumineux", async () => {
    await expect(readJsonBody(post(JSON.stringify({ a: "x".repeat(100) })), 20)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("refuse un JSON invalide", async () => {
    await expect(readJsonBody(post("{pas du json"), 1024)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("refuse un body absent", async () => {
    const request = new Request("http://localhost/api/x", { method: "POST" });
    await expect(readJsonBody(request, 1024)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("parseInput", () => {
  const schema = z.object({ user: z.object({ age: z.number() }) });

  it("renvoie la donnée validée", () => {
    expect(parseInput(schema, { user: { age: 3 } })).toEqual({ user: { age: 3 } });
  });

  it("renvoie le chemin des champs invalides", () => {
    try {
      parseInput(schema, { user: { age: "x" } });
      expect.unreachable();
    } catch (e) {
      const err = e as { code: string; details: { issues: { path: string }[] } };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.details.issues[0].path).toBe("user.age");
    }
  });
});