import { describe, expect, it } from "vitest";
import { generateCode, resolveVariables } from "@/client/features/requests/export-code";
import { emptyBody, emptyDraft, type RequestDraft } from "@/client/features/requests/model";

const draft = (patch: Partial<RequestDraft> = {}): RequestDraft => ({
  ...emptyDraft(),
  url: "https://api.exemple.com/v1/products?page=1",
  ...patch,
});

describe("resolveVariables", () => {
  it("remplace les variables connues et laisse les autres", () => {
    expect(resolveVariables("{{base}}/x/{{inconnue}}", { base: "https://a.test" })).toBe("https://a.test/x/{{inconnue}}");
  });
});

describe("cURL", () => {
  it("génère un GET avec authentification Bearer et redirections", () => {
    const code = generateCode("curl", draft({ auth: { type: "bearer", token: "{{token}}" } }), { token: "abc" });
    expect(code).toBe(
      "curl 'https://api.exemple.com/v1/products?page=1' \\\n  -H 'Authorization: Bearer abc' \\\n  -L",
    );
  });

  it("génère un POST JSON avec l'en-tête de type de contenu", () => {
    const code = generateCode(
      "curl",
      draft({ method: "POST", url: "https://x.test/orders", body: { ...emptyBody(), kind: "json", content: '{"a":1}' } }),
    );
    expect(code).toBe(
      "curl -X POST 'https://x.test/orders' \\\n  -H 'Content-Type: application/json' \\\n  -L \\\n  --data-raw '{\"a\":1}'",
    );
  });

  it("protège les apostrophes dans le corps", () => {
    const code = generateCode(
      "curl",
      draft({ method: "POST", body: { ...emptyBody(), kind: "raw", content: "it's ok", contentType: "text/plain" } }),
    );
    expect(code).toContain("--data-raw 'it'\\''s ok'");
  });

  it("gère Basic, clé d'API en requête, et l'absence de redirection", () => {
    const basic = generateCode("curl", draft({ auth: { type: "basic", username: "emma", password: "pw" }, followRedirects: false }));
    expect(basic).toContain("-u 'emma:pw'");
    expect(basic).not.toContain("-L");

    const apiKey = generateCode("curl", draft({ auth: { type: "apiKey", key: "api_key", value: "k 1", in: "query" } }));
    expect(apiKey).toContain("'https://api.exemple.com/v1/products?page=1&api_key=k%201'");
  });

  it("ignore les en-têtes désactivés et garde un Content-Type choisi par l'utilisateur", () => {
    const code = generateCode(
      "curl",
      draft({
        method: "POST",
        headers: [
          { key: "Content-Type", value: "application/vnd.api+json", enabled: true },
          { key: "X-Debug", value: "1", enabled: false },
        ],
        body: { ...emptyBody(), kind: "json", content: "{}" },
      }),
    );
    expect(code).toContain("-H 'Content-Type: application/vnd.api+json'");
    expect(code).not.toContain("application/json");
    expect(code).not.toContain("X-Debug");
  });

  it("encode les champs urlencoded et form-data", () => {
    const fields = [{ key: "a", value: "1", enabled: true }];
    expect(generateCode("curl", draft({ method: "POST", body: { ...emptyBody(), kind: "urlencoded", fields } }))).toContain("--data-urlencode 'a=1'");
    expect(generateCode("curl", draft({ method: "POST", body: { ...emptyBody(), kind: "form-data", fields } }))).toContain("-F 'a=1'");
  });
});

describe("Fetch", () => {
  it("génère un appel fetch avec méthode, en-têtes et corps", () => {
    const code = generateCode(
      "fetch",
      draft({ method: "POST", url: "https://x.test/orders", body: { ...emptyBody(), kind: "json", content: '{"a":1}' } }),
    );
    expect(code).toContain('await fetch("https://x.test/orders"');
    expect(code).toContain('method: "POST"');
    expect(code).toContain('"Content-Type": "application/json"');
    expect(code).toContain('body: "{\\"a\\":1}"');
    expect(code).toContain('redirect: "follow"');
  });

  it("construit l'en-tête Basic avec btoa", () => {
    const code = generateCode("fetch", draft({ auth: { type: "basic", username: "emma", password: "pw" } }));
    expect(code).toContain('"Authorization": "Basic " + btoa("emma:pw")');
  });
});

describe("HTTPie", () => {
  it("génère un GET minimal", () => {
    expect(generateCode("httpie", draft({ url: "https://x.test/a" }))).toBe("http --follow GET 'https://x.test/a'");
  });

  it("ajoute en-têtes, authentification et corps brut", () => {
    const code = generateCode(
      "httpie",
      draft({
        method: "POST",
        url: "https://x.test/a",
        auth: { type: "bearer", token: "t" },
        body: { ...emptyBody(), kind: "json", content: '{"a":1}' },
      }),
    );
    expect(code).toContain("--raw '{\"a\":1}' POST 'https://x.test/a'");
    expect(code).toContain("'Authorization:Bearer t'");
    expect(code).toContain("'Content-Type:application/json'");
  });
});