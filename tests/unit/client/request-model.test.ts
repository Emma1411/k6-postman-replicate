import { describe, expect, it } from "vitest";
import { emptyBody, emptyDraft, isRequestDraft, toHttpRequest, validateDraft } from "@/client/features/requests/model";
import { HttpRequestSchema } from "@/shared/schemas";

describe("toHttpRequest", () => {
  it("produit une requête acceptée par le schéma du serveur", () => {
    const draft = {
      ...emptyDraft(),
      name: " Liste ",
      method: "POST" as const,
      url: " https://api.exemple.com/v1/products?page=1 ",
      headers: [
        { key: "Accept", value: "application/json", enabled: true },
        { key: "X-Off", value: "1", enabled: false },
        { key: "  ", value: "vide", enabled: true },
      ],
      body: { ...emptyBody(), kind: "form-data" as const, fields: [{ key: "a", value: "1", enabled: true }, { key: "b", value: "2", enabled: false }] },
      timeoutMs: 5000,
    };
    const request = toHttpRequest(draft);
    expect(HttpRequestSchema.safeParse(request).success).toBe(true);
    expect(request.name).toBe("Liste");
    expect(request.url).toBe("https://api.exemple.com/v1/products?page=1");
    expect(request.params).toEqual([]);
    expect(request.headers).toEqual([{ key: "Accept", value: "application/json", enabled: true }]);
    expect(request.body).toEqual({ type: "form-data", fields: [{ kind: "text", key: "a", value: "1", enabled: true }] });
    expect(request.timeoutMs).toBe(5000);
  });

  it("utilise text/plain pour un corps brut sans type", () => {
    const request = toHttpRequest({ ...emptyDraft(), url: "https://x.test", body: { ...emptyBody(), kind: "raw", content: "x", contentType: " " } });
    expect(request.body).toEqual({ type: "raw", content: "x", contentType: "text/plain" });
  });
});

describe("validateDraft", () => {
  it("exige une adresse http(s) ou une variable", () => {
    expect(validateDraft(emptyDraft())).toMatch(/adresse/i);
    expect(validateDraft({ ...emptyDraft(), url: "example.com" })).toMatch(/http/);
    expect(validateDraft({ ...emptyDraft(), url: "https://example.com" })).toBeNull();
    expect(validateDraft({ ...emptyDraft(), url: "{{base_url}}/users" })).toBeNull();
  });
});

describe("isRequestDraft", () => {
  it("reconnaît un brouillon valide et rejette le reste", () => {
    expect(isRequestDraft(emptyDraft())).toBe(true);
    expect(isRequestDraft(null)).toBe(false);
    expect(isRequestDraft({ method: "GET" })).toBe(false);
    expect(isRequestDraft({ ...emptyDraft(), headers: "x" })).toBe(false);
  });
});