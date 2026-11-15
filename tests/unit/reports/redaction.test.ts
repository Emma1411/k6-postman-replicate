import { describe, expect, it } from "vitest";
import { MASK, isSensitiveName, maskValue, redactText, redactUrl, redactWorkflowResult } from "@/shared/reports/redaction";
import { workflowResult } from "../../helpers/report-fixtures";

describe("isSensitiveName / maskValue", () => {
  it.each(["token", "accessToken", "Authorization", "X-API-Key", "api_key", "password", "client_secret", "Cookie", "sessionId", "private-key", "bearerAuth_token"])(
    "reconnaît %s",
    (name) => expect(isSensitiveName(name)).toBe(true),
  );

  it.each(["base", "userId", "name", "limit", "Content-Type"])("laisse passer %s", (name) => expect(isSensitiveName(name)).toBe(false));

  it("masque la valeur d'un nom sensible seulement", () => {
    expect(maskValue("token", "abc")).toBe(MASK);
    expect(maskValue("base", "http://x")).toBe("http://x");
  });
});

describe("redactUrl", () => {
  it("masque les paramètres sensibles et conserve les autres", () => {
    expect(redactUrl("http://x/login?api_key=secretvalue&q=1&access_token=t")).toBe(`http://x/login?api_key=${MASK}&q=1&access_token=${MASK}`);
  });

  it("masque les identifiants intégrés à l'URL", () => {
    expect(redactUrl("https://user:pass@host.com/a")).toBe(`https://${MASK}@host.com/a`);
    expect(redactUrl("https://host.com/a")).toBe("https://host.com/a");
  });

  it("fonctionne avec des variables {{...}} et des noms encodés", () => {
    expect(redactUrl("{{base}}/x?api_key={{key}}&q=1")).toBe(`{{base}}/x?api_key=${MASK}&q=1`);
    expect(redactUrl("http://x/?api%5Fkey=abc")).toBe(`http://x/?api%5Fkey=${MASK}`);
  });
});

describe("redactText", () => {
  it("masque les jetons Bearer et Basic", () => {
    expect(redactText("Authorization: Bearer abcdef1234567890")).toBe(`Authorization: Bearer ${MASK}`);
    expect(redactText("Basic dXNlcjpwYXNzd29yZA==")).toBe(`Basic ${MASK}`);
  });

  it("masque les JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl";
    expect(redactText(`jeton ${jwt} reçu`)).toBe(`jeton ${MASK} reçu`);
  });

  it("masque les valeurs associées à un nom sensible, en JSON comme en clé=valeur", () => {
    expect(redactText('{"token":"zzz","ok":true}')).toBe(`{"token":"${MASK}","ok":true}`);
    expect(redactText("password=hunter2&x=1")).toBe(`password=${MASK}&x=1`);
    expect(redactText('{"client_secret": "abc"}')).toBe(`{"client_secret": "${MASK}"}`);
  });

  it("ne touche pas aux textes ordinaires", () => {
    const text = "Statut attendu 200, reçu 404. Variables non définies : token";
    expect(redactText(text)).toBe(text);
  });
});

describe("redactWorkflowResult", () => {
  it("masque variables, valeurs extraites et URLs, et retire les aperçus par défaut", () => {
    const out = redactWorkflowResult(workflowResult(), false);
    expect(out.variables).toEqual({ token: MASK, base: "http://x" });
    expect(out.steps[0].extracted).toEqual({ token: MASK });
    expect(out.steps[0].response?.finalUrl).toBe(`http://x/login?api_key=${MASK}&q=1`);
    expect(out.steps[0].response?.preview).toBeNull();
  });

  it("conserve les aperçus à la demande, eux aussi expurgés", () => {
    const out = redactWorkflowResult(workflowResult(), true);
    expect(out.steps[0].response?.preview).toBe(`{"token":"${MASK}","ok":true}`);
  });

  it("masque les secrets des messages d'assertion et d'erreur", () => {
    const input = workflowResult();
    input.steps[1].assertions[0].message = "Reçu : Bearer abcdef1234567890";
    input.steps[1].error = { code: "UPSTREAM_ERROR", message: "refus : password=hunter2" };
    const out = redactWorkflowResult(input, false);
    expect(out.steps[1].assertions[0].message).toBe(`Reçu : Bearer ${MASK}`);
    expect(out.steps[1].error?.message).toBe(`refus : password=${MASK}`);
  });

  it("ne modifie pas l'original", () => {
    const input = workflowResult();
    redactWorkflowResult(input, false);
    expect(input.variables.token).toBe("abc123");
    expect(input.steps[0].response?.preview).toBe('{"token":"zzz","ok":true}');
  });
});