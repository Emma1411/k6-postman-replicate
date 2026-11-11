import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeHttpRequest } from "@/server/services/http-executor";
import { buildLimits } from "@/server/config/limits";
import { parseEnv } from "@/server/config/env.schema";
import { validateTarget } from "@/server/middlewares/ssrf-guard";
import { AppError } from "@/server/utils/errors";
import { ExecuteRequestInputSchema } from "@/shared/schemas";
import { startTargetServer, type TargetServer } from "../target-server/server";

const MB = 1024 * 1024;
const limits = buildLimits(
  parseEnv({ ALLOW_PRIVATE_NETWORKS: "true", HTTP_MAX_REDIRECTS: "5", HTTP_MAX_RESPONSE_BYTES: String(MB) }),
);

type Limits = typeof limits;

function run(
  request: Record<string, unknown>,
  variables: Record<string, string> = {},
  l: Limits = limits,
  deps: { validate?: typeof validateTarget } = {},
) {
  const input = ExecuteRequestInputSchema.parse({ request, variables });
  return executeHttpRequest(input, { limits: l, ...deps });
}

const echoOf = (res: { body: { content: string } }) => JSON.parse(res.body.content);

let a: TargetServer;
let b: TargetServer;

beforeAll(async () => {
  a = await startTargetServer();
  b = await startTargetServer();
});
afterAll(async () => {
  await a.close();
  await b.close();
});

describe("requêtes de base", () => {
  it("exécute un GET et renvoie statut, body et timings", async () => {
    const res = await run({ method: "GET", url: `${a.url}/echo` });
    expect(res.status).toBe(200);
    expect(echoOf(res).method).toBe("GET");
    expect(res.finalUrl).toBe(`${a.url}/echo`);
    expect(res.redirects).toEqual([]);
    expect(res.timings.totalMs).toBeGreaterThan(0);
    expect(res.timings.dnsMs).toBeNull();
    expect(res.timings.tlsMs).toBeNull();
    expect(res.timings.connectMs).not.toBeNull();
    expect(echoOf(res).headers["user-agent"]).toBe("ApiEngineeringPlatform/1.0");
  });

  it("mesure le TTFB", async () => {
    const res = await run({ method: "GET", url: `${a.url}/delay/200` });
    expect(res.timings.ttfbMs).toBeGreaterThanOrEqual(150);
  });

  it("renvoie les erreurs HTTP comme des réponses normales", async () => {
    const r404 = await run({ method: "GET", url: `${a.url}/status/404` });
    expect(r404.status).toBe(404);
    expect(r404.body.content).toBe("status 404");
    expect((await run({ method: "GET", url: `${a.url}/status/500` })).status).toBe(500);
  });

  it("ne renvoie pas de body pour HEAD", async () => {
    const res = await run({ method: "HEAD", url: `${a.url}/echo` });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("");
    expect(res.sizeBytes).toBe(0);
  });

  it("conserve les headers en double (Set-Cookie)", async () => {
    const res = await run({ method: "GET", url: `${a.url}/cookies` });
    expect(res.headers.filter((h) => h.key.toLowerCase() === "set-cookie")).toHaveLength(2);
  });
});

describe("params, headers et authentification", () => {
  it("ajoute les params activés et la clé d'API en query", async () => {
    const res = await run({
      method: "GET",
      url: `${a.url}/echo?x=1`,
      params: [
        { key: "y", value: "2" },
        { key: "off", value: "3", enabled: false },
      ],
      headers: [{ key: "X-Test", value: "hello" }],
      auth: { type: "apiKey", key: "api_key", value: "k1", in: "query" },
    });
    const echo = echoOf(res);
    expect(echo.path).toBe("/echo?x=1&y=2&api_key=k1");
    expect(echo.headers["x-test"]).toBe("hello");
  });

  it("gère Basic, Bearer et la clé d'API en header", async () => {
    const basic = await run({ method: "GET", url: `${a.url}/echo`, auth: { type: "basic", username: "user", password: "pass" } });
    expect(echoOf(basic).headers.authorization).toBe("Basic dXNlcjpwYXNz");

    const bearer = await run({ method: "GET", url: `${a.url}/echo`, auth: { type: "bearer", token: "tok" } });
    expect(echoOf(bearer).headers.authorization).toBe("Bearer tok");

    const apiKey = await run({ method: "GET", url: `${a.url}/echo`, auth: { type: "apiKey", key: "X-Api-Key", value: "k" } });
    expect(echoOf(apiKey).headers["x-api-key"]).toBe("k");
  });

  it("laisse un header explicite l'emporter sur l'authentification", async () => {
    const res = await run({
      method: "GET",
      url: `${a.url}/echo`,
      auth: { type: "bearer", token: "tok" },
      headers: [{ key: "Authorization", value: "Custom" }],
    });
    expect(echoOf(res).headers.authorization).toBe("Custom");
  });

  it("refuse les headers gérés automatiquement ou invalides", async () => {
    for (const header of [
      { key: "Content-Length", value: "5" },
      { key: "Transfer-Encoding", value: "chunked" },
      { key: "X-Bad", value: "a\r\nInjected: 1" },
      { key: "bad name", value: "x" },
    ]) {
      await expect(run({ method: "GET", url: `${a.url}/echo`, headers: [header] })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
  });
});

describe("bodies", () => {
  it("envoie du JSON avec Content-Type et Content-Length", async () => {
    const res = await run({ method: "POST", url: `${a.url}/echo`, body: { type: "json", content: '{"a":1}' } });
    const echo = echoOf(res);
    expect(echo.body).toBe('{"a":1}');
    expect(echo.headers["content-type"]).toBe("application/json");
    expect(echo.headers["content-length"]).toBe("7");
  });

  it("laisse un Content-Type explicite l'emporter pour un body JSON", async () => {
    const res = await run({
      method: "POST",
      url: `${a.url}/echo`,
      headers: [{ key: "Content-Type", value: "application/vnd.api+json" }],
      body: { type: "json", content: "{}" },
    });
    expect(echoOf(res).headers["content-type"]).toBe("application/vnd.api+json");
  });

  it("encode urlencoded", async () => {
    const res = await run({
      method: "POST",
      url: `${a.url}/echo`,
      body: {
        type: "urlencoded",
        fields: [
          { key: "a", value: "1 2" },
          { key: "b", value: "x&y" },
        ],
      },
    });
    const echo = echoOf(res);
    expect(echo.body).toBe("a=1+2&b=x%26y");
    expect(echo.headers["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("encode form-data avec un fichier", async () => {
    const res = await run({
      method: "POST",
      url: `${a.url}/echo`,
      body: {
        type: "form-data",
        fields: [
          { kind: "text", key: "name", value: "emma" },
          { kind: "file", key: "f", filename: "a.txt", contentType: "text/plain", base64: Buffer.from("hello").toString("base64") },
        ],
      },
    });
    const echo = echoOf(res);
    expect(echo.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(echo.body).toContain('name="name"');
    expect(echo.body).toContain("emma");
    expect(echo.body).toContain('filename="a.txt"');
    expect(echo.body).toContain("hello");
  });

  it("envoie un body binaire", async () => {
    const res = await run({
      method: "POST",
      url: `${a.url}/echo`,
      body: { type: "binary", base64: Buffer.from([1, 2, 3]).toString("base64") },
    });
    const echo = echoOf(res);
    expect(echo.headers["content-type"]).toBe("application/octet-stream");
    expect(echo.headers["content-length"]).toBe("3");
  });

  it("refuse un body sur GET", async () => {
    await expect(
      run({ method: "GET", url: `${a.url}/echo`, body: { type: "json", content: "{}" } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuse un body trop volumineux", async () => {
    const small = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true", HTTP_MAX_REQUEST_BODY_BYTES: "1024" }));
    await expect(
      run({ method: "POST", url: `${a.url}/echo`, body: { type: "raw", content: "x".repeat(2000) } }, {}, small),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});

describe("variables", () => {
  it("interpole l'URL et les headers", async () => {
    const res = await run(
      { method: "GET", url: "{{base}}/echo", headers: [{ key: "X-Id", value: "{{id}}" }] },
      { base: a.url, id: "42" },
    );
    expect(echoOf(res).headers["x-id"]).toBe("42");
  });

  it("n'interprète pas les motifs spéciaux dans les valeurs", async () => {
    const res = await run(
      { method: "GET", url: `${a.url}/echo`, headers: [{ key: "X-V", value: "{{v}}" }] },
      { v: "$&x" },
    );
    expect(echoOf(res).headers["x-v"]).toBe("$&x");
  });

  it("signale les variables non définies", async () => {
    await expect(run({ method: "GET", url: "{{base}}/echo/{{id}}" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { variables: ["base", "id"] },
    });
  });
});

describe("redirections", () => {
  it("suit les redirections et les liste", async () => {
    const res = await run({ method: "GET", url: `${a.url}/redirect/3` });
    expect(res.status).toBe(200);
    expect(res.redirects).toHaveLength(3);
    expect(res.redirects[0]).toEqual({ url: `${a.url}/redirect/3`, status: 302 });
    expect(res.finalUrl).toBe(`${a.url}/echo`);
  });

  it("ne suit pas les redirections si followRedirects est faux", async () => {
    const res = await run({ method: "GET", url: `${a.url}/redirect/1`, followRedirects: false });
    expect(res.status).toBe(302);
    expect(res.headers.find((h) => h.key.toLowerCase() === "location")?.value).toBe("/echo");
  });

  it("refuse trop de redirections", async () => {
    const strict = buildLimits(parseEnv({ ALLOW_PRIVATE_NETWORKS: "true", HTTP_MAX_REDIRECTS: "2" }));
    await expect(run({ method: "GET", url: `${a.url}/redirect/5` }, {}, strict)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("transforme POST en GET sur 302 et retire le body", async () => {
    const res = await run({
      method: "POST",
      url: `${a.url}/redirect/1?code=302`,
      body: { type: "json", content: '{"a":1}' },
    });
    const echo = echoOf(res);
    expect(echo.method).toBe("GET");
    expect(echo.body).toBe("");
    expect(echo.headers["content-type"]).toBeUndefined();
  });

  it("conserve la méthode et le body sur 307", async () => {
    const res = await run({
      method: "POST",
      url: `${a.url}/redirect/1?code=307`,
      body: { type: "json", content: '{"a":1}' },
    });
    const echo = echoOf(res);
    expect(echo.method).toBe("POST");
    expect(echo.body).toBe('{"a":1}');
  });

  it("transforme PUT en GET sur 303", async () => {
    const res = await run({ method: "PUT", url: `${a.url}/redirect/1?code=303`, body: { type: "raw", content: "x" } });
    expect(echoOf(res).method).toBe("GET");
  });

  it("garde Authorization sur la même origine", async () => {
    const res = await run({ method: "GET", url: `${a.url}/redirect/1`, auth: { type: "bearer", token: "tok" } });
    expect(echoOf(res).headers.authorization).toBe("Bearer tok");
  });

  it("retire Authorization quand l'origine change", async () => {
    const res = await run({
      method: "GET",
      url: `${a.url}/redirect-to?url=${encodeURIComponent(`${b.url}/echo`)}`,
      auth: { type: "bearer", token: "tok" },
      headers: [{ key: "Cookie", value: "s=1" }],
    });
    const echo = echoOf(res);
    expect(res.finalUrl).toBe(`${b.url}/echo`);
    expect(echo.headers.authorization).toBeUndefined();
    expect(echo.headers.cookie).toBeUndefined();
  });

  it("valide la destination de chaque redirection", async () => {
    const calls: string[] = [];
    const validate: typeof validateTarget = async (url, l, r) => {
      calls.push(url);
      if (url.includes("/forbidden")) throw new AppError("SSRF_BLOCKED", "bloqué");
      return validateTarget(url, l, r);
    };

    await run({ method: "GET", url: `${a.url}/redirect/1` }, {}, limits, { validate });
    expect(calls).toHaveLength(2);

    await expect(
      run(
        { method: "GET", url: `${a.url}/redirect-to?url=${encodeURIComponent(`${a.url}/forbidden`)}` },
        {},
        limits,
        { validate },
      ),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
});

describe("réponses", () => {
  it("décompresse gzip et brotli", async () => {
    expect(echoOf(await run({ method: "GET", url: `${a.url}/gzip` })).hello).toBe("gzip");
    expect(echoOf(await run({ method: "GET", url: `${a.url}/brotli` })).hello).toBe("brotli");
  });

  it("tronque une bombe de décompression", async () => {
    const res = await run({ method: "GET", url: `${a.url}/bomb` });
    expect(res.body.truncated).toBe(true);
    expect(res.sizeBytes).toBe(MB);
  });

  it("tronque un body trop gros", async () => {
    const res = await run({ method: "GET", url: `${a.url}/large?bytes=3000000` });
    expect(res.body.truncated).toBe(true);
    expect(res.sizeBytes).toBe(MB);
    expect(res.body.encoding).toBe("utf8");
    expect(res.body.content).toHaveLength(MB);
  });

  it("renvoie le binaire en base64", async () => {
    const res = await run({ method: "GET", url: `${a.url}/binary` });
    expect(res.body.encoding).toBe("base64");
    expect(res.body.content).toBe("AAEC//4=");
  });
});

describe("erreurs", () => {
  it("signale un dépassement de délai", async () => {
    await expect(run({ method: "GET", url: `${a.url}/delay/1000`, timeoutMs: 150 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("signale une connexion refusée", async () => {
    const closed = await startTargetServer();
    const url = closed.url;
    await closed.close();
    await expect(run({ method: "GET", url: `${url}/echo` })).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("bloque les destinations privées quand la garde est active", async () => {
    const strict = buildLimits(parseEnv({}));
    await expect(run({ method: "GET", url: `${a.url}/echo` }, {}, strict)).rejects.toMatchObject({
      code: "SSRF_BLOCKED",
    });
  });
});