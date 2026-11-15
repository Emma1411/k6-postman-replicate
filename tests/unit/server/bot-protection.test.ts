import { describe, expect, it } from "vitest";
import {
  AttemptLimiter, PASS_COOKIE, assertHuman, issuePass, networkKey, verifyPass, verifyTurnstile,
  type BotConfig,
} from "@/server/middlewares/bot-protection";
import { verifyBotController } from "@/server/controllers/bot.controller";

const config: BotConfig = {
  mode: "turnstile",
  turnstileSecret: "turnstile-secret",
  tokenSecret: "x".repeat(40),
  ttlSeconds: 3600,
  bindIp: true,
  allowedOrigins: [],
};
const IP = "203.0.113.5";
const NOW = 1_800_000_000_000;

const codeOf = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return (e as { code?: string }).code; }
  return undefined;
};
const codeOfAsync = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
  try { await fn(); } catch (e) { return (e as { code?: string }).code; }
  return undefined;
};

const post = (cookie?: string, headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/load-tests/run", {
    method: "POST",
    headers: { ...(cookie ? { cookie: `${PASS_COOKIE}=${cookie}` } : {}), ...headers },
  });

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; body: string }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("networkKey", () => {
  it("garde l'IPv4 et réduit l'IPv6 à son /64", () => {
    expect(networkKey("203.0.113.5")).toBe("203.0.113.5");
    expect(networkKey("2001:db8:abcd:12:1:2:3:4")).toBe("2001:0db8:abcd:0012");
    expect(networkKey("2001:db8:abcd:12::9")).toBe("2001:0db8:abcd:0012");
    expect(networkKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("laissez-passer", () => {
  it("un laissez-passer émis est valide pour le même réseau", () => {
    const { token } = issuePass(config, IP, NOW);
    expect(verifyPass(config, token, IP, NOW + 1000)).toBe("valid");
  });

  it("expire après le TTL", () => {
    const { token } = issuePass(config, IP, NOW);
    expect(verifyPass(config, token, IP, NOW + 3600 * 1000 + 1000)).toBe("expired");
  });

  it("refuse un autre réseau, sauf si BOT_BIND_IP est désactivé", () => {
    const { token } = issuePass(config, IP, NOW);
    expect(verifyPass(config, token, "198.51.100.9", NOW)).toBe("wrong-network");
    const unbound = { ...config, bindIp: false };
    const free = issuePass(unbound, IP, NOW).token;
    expect(verifyPass(unbound, free, "198.51.100.9", NOW)).toBe("valid");
  });

  it("refuse un contenu modifié et un autre secret", () => {
    const { token } = issuePass(config, IP, NOW);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, exp: 9_999_999_999, jti: "x" })).toString("base64url");
    expect(verifyPass(config, `${forged}.${sig}`, IP, NOW)).toBe("bad-signature");
    expect(verifyPass({ ...config, tokenSecret: "y".repeat(40) }, `${body}.${sig}`, IP, NOW)).toBe("bad-signature");
  });

  it("refuse les jetons absents ou mal formés", () => {
    expect(verifyPass(config, undefined, IP, NOW)).toBe("missing");
    expect(verifyPass(config, "", IP, NOW)).toBe("missing");
    expect(verifyPass(config, "abc", IP, NOW)).toBe("malformed");
    expect(verifyPass(config, "a.b.c", IP, NOW)).toBe("malformed");
    expect(verifyPass(config, "a".repeat(600), IP, NOW)).toBe("malformed");
    expect(verifyPass(config, "a.b", IP, NOW)).toBe("bad-signature");
  });
});

describe("assertHuman", () => {
  it("ne fait rien quand la protection est désactivée", () => {
    expect(codeOf(() => assertHuman(post(), IP, { ...config, mode: "off" }))).toBeUndefined();
  });

  it("exige un laissez-passer valide", () => {
    expect(codeOf(() => assertHuman(post(), IP, config))).toBe("CHALLENGE_REQUIRED");
    const { token } = issuePass(config, IP);
    expect(codeOf(() => assertHuman(post(token), IP, config))).toBeUndefined();
  });

  it("refuse un laissez-passer volé utilisé depuis un autre réseau", () => {
    const { token } = issuePass(config, IP);
    expect(codeOf(() => assertHuman(post(token), "198.51.100.9", config))).toBe("CHALLENGE_REQUIRED");
  });

  it("contrôle l'origine des requêtes de navigateur", () => {
    const { token } = issuePass(config, IP);
    const same = post(token, { origin: "https://app.test", "x-forwarded-host": "app.test" });
    const evil = post(token, { origin: "https://evil.test", "x-forwarded-host": "app.test" });
    const opaque = post(token, { origin: "null", "x-forwarded-host": "app.test" });
    expect(codeOf(() => assertHuman(same, IP, config))).toBeUndefined();
    expect(codeOf(() => assertHuman(evil, IP, config))).toBe("ORIGIN_NOT_ALLOWED");
    expect(codeOf(() => assertHuman(opaque, IP, config))).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("accepte une origine explicitement autorisée", () => {
    const { token } = issuePass(config, IP);
    const allowed = { ...config, allowedOrigins: ["https://outils.exemple.com"] };
    const req = post(token, { origin: "https://outils.exemple.com", "x-forwarded-host": "app.test" });
    expect(codeOf(() => assertHuman(req, IP, allowed))).toBeUndefined();
  });
});

describe("verifyTurnstile", () => {
  it("envoie secret, réponse et IP, et retourne le verdict", async () => {
    const f = fakeFetch({ success: true });
    const r = await verifyTurnstile(config, "tok", IP, f.fn);
    expect(r.ok).toBe(true);
    expect(f.calls[0].url).toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(f.calls[0].body).toContain("secret=turnstile-secret");
    expect(f.calls[0].body).toContain("response=tok");
    expect(f.calls[0].body).toContain("remoteip=203.0.113.5");
  });

  it("retourne les codes d'erreur d'un défi refusé", async () => {
    const f = fakeFetch({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile(config, "tok", IP, f.fn)).toEqual({ ok: false, errorCodes: ["invalid-input-response"] });
  });

  it("refuse (fail closed) si Cloudflare est indisponible ou répond n'importe quoi", async () => {
    const down = (async () => { throw new Error("réseau coupé"); }) as unknown as typeof fetch;
    expect(await codeOfAsync(() => verifyTurnstile(config, "t", IP, down))).toBe("UPSTREAM_ERROR");
    expect(await codeOfAsync(() => verifyTurnstile(config, "t", IP, fakeFetch({}, 500).fn))).toBe("UPSTREAM_ERROR");
    expect(await codeOfAsync(() => verifyTurnstile(config, "t", IP, fakeFetch({ nimporte: "quoi" }).fn))).toBe("UPSTREAM_ERROR");
  });
});

describe("AttemptLimiter", () => {
  it("bloque au-delà du maximum puis libère après la fenêtre", () => {
    const l = new AttemptLimiter(2, 1000);
    expect(l.hit("a", 0)).toBe(true);
    expect(l.hit("a", 10)).toBe(true);
    expect(l.hit("a", 20)).toBe(false);
    expect(l.hit("b", 20)).toBe(true);
    expect(l.hit("a", 2000)).toBe(true);
  });
});

describe("verifyBotController", () => {
  const request = new Request("https://app.test/api/bot/verify", {
    method: "POST",
    headers: { "x-forwarded-proto": "https" },
  });

  it("ne fait rien quand la protection est désactivée", async () => {
    const res = await verifyBotController({ token: "t" }, { ip: IP, request }, { ...config, mode: "off" });
    expect(await res.json()).toEqual({ ok: true, enabled: false });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("pose un cookie sûr et le laissez-passer émis est valide", async () => {
    const f = fakeFetch({ success: true });
    const res = await verifyBotController({ token: "ok" }, { ip: "192.0.2.10", request }, config, { fetch: f.fn });
    const cookie = res.headers.get("set-cookie")!;
    for (const part of ["HttpOnly", "SameSite=Strict", "Path=/api", "Max-Age=3600", "Secure"]) {
      expect(cookie).toContain(part);
    }
    const token = /aep_pass=([^;]+)/.exec(cookie)![1];
    expect(verifyPass(config, token, "192.0.2.10", Date.now())).toBe("valid");
  });

  it("n'ajoute pas Secure en HTTP simple (développement local)", async () => {
    const http = new Request("http://localhost:3000/api/bot/verify", { method: "POST" });
    const res = await verifyBotController({ token: "ok" }, { ip: "192.0.2.11", request: http }, config, {
      fetch: fakeFetch({ success: true }).fn,
    });
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("refuse un défi invalide sans émettre de cookie", async () => {
    const f = fakeFetch({ success: false, "error-codes": ["timeout-or-duplicate"] });
    const code = await codeOfAsync(() =>
      verifyBotController({ token: "mauvais" }, { ip: "192.0.2.12", request }, config, { fetch: f.fn }),
    );
    expect(code).toBe("CHALLENGE_FAILED");
  });

  it("limite les tentatives par réseau", async () => {
    const f = fakeFetch({ success: false });
    const attempt = () => codeOfAsync(() =>
      verifyBotController({ token: "t" }, { ip: "198.51.100.77", request }, config, { fetch: f.fn }),
    );
    for (let i = 0; i < 10; i++) expect(await attempt()).toBe("CHALLENGE_FAILED");
    expect(await attempt()).toBe("RATE_LIMITED");
    expect(f.calls).toHaveLength(10); // la 11e n'a pas consommé de quota Cloudflare
  });
});