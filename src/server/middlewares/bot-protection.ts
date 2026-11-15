import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { Env } from "@/server/config/env.schema";
import { AppError } from "@/server/utils/errors";
import { logger } from "@/server/utils/logger";

export const PASS_COOKIE = "aep_pass";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 5000;

export interface BotConfig {
  mode: "off" | "turnstile";
  turnstileSecret?: string;
  tokenSecret?: string;
  ttlSeconds: number;
  bindIp: boolean;
  allowedOrigins: string[];
}

export function botConfigFromEnv(env: Env): BotConfig {
  return {
    mode: env.BOT_PROTECTION,
    turnstileSecret: env.TURNSTILE_SECRET_KEY,
    tokenSecret: env.BOT_TOKEN_SECRET,
    ttlSeconds: env.BOT_PASS_TTL_SECONDS,
    bindIp: env.BOT_BIND_IP,
    allowedOrigins: env.ALLOWED_ORIGINS,
  };
}

/* ───────────── Réseau de l'utilisateur ───────────── */

/**
 * Clé de réseau : IPv4 telle quelle, IPv6 réduite à son préfixe /64.
 * Une même personne change souvent d'adresse IPv6 (extensions de confidentialité) à l'intérieur du /64.
 */
export function networkKey(rawIp: string): string {
  const ip = rawIp.split("%")[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const hasGap = ip.includes("::");
  const [left, right] = hasGap ? ip.split("::") : [ip, ""];
  const l = left ? left.split(":") : [];
  const r = right ? right.split(":") : [];
  const groups = hasGap ? [...l, ...Array<string>(Math.max(0, 8 - l.length - r.length)).fill("0"), ...r] : l;
  return groups
    .slice(0, 4)
    .map((g) => g.padStart(4, "0").toLowerCase())
    .join(":");
}

/* ───────────── Laissez-passer signé ───────────── */

export type PassCheck =
  | "valid"
  | "missing"
  | "malformed"
  | "bad-signature"
  | "expired"
  | "wrong-network";

function requireSecret(config: BotConfig): string {
  if (!config.tokenSecret) throw new AppError("INTERNAL_ERROR", "Protection anti-robot mal configurée.");
  return config.tokenSecret;
}

const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest();

function networkTag(config: BotConfig, ip: string): string {
  return createHmac("sha256", requireSecret(config)).update(`net|${networkKey(ip)}`).digest("hex").slice(0, 16);
}

export function issuePass(config: BotConfig, ip: string, nowMs = Date.now()): { token: string; expiresAt: number } {
  const secret = requireSecret(config);
  const exp = Math.floor(nowMs / 1000) + config.ttlSeconds;
  const payload = {
    v: 1,
    exp,
    jti: randomUUID(),
    ...(config.bindIp ? { net: networkTag(config, ip) } : {}),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(secret, body).toString("base64url");
  return { token: `${body}.${signature}`, expiresAt: exp * 1000 };
}

export function verifyPass(config: BotConfig, token: string | undefined, ip: string, nowMs = Date.now()): PassCheck {
  if (!token) return "missing";
  const parts = token.split(".");
  if (parts.length !== 2 || token.length > 512) return "malformed";
  const [body, givenSig] = parts;

  const expected = sign(requireSecret(config), body);
  const given = Buffer.from(givenSig, "base64url");
  // La signature est vérifiée AVANT de lire le contenu.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "bad-signature";

  let payload: { v?: unknown; exp?: unknown; net?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return "malformed";
  }
  if (payload?.v !== 1 || typeof payload.exp !== "number") return "malformed";
  if (payload.exp * 1000 <= nowMs) return "expired";
  if (config.bindIp && payload.net !== networkTag(config, ip)) return "wrong-network";
  return "valid";
}

/* ───────────── Contrôles sur la requête ───────────── */

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

function expectedHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("host");
}

/**
 * Anti-CSRF : un navigateur envoie toujours `Origin` sur un POST. S'il est présent, il doit désigner
 * notre propre hôte ou une origine autorisée. Absent (curl, scripts) : pas de contrôle ici, c'est le
 * laissez-passer qui protège.
 */
export function assertSameOrigin(request: Request, config: BotConfig): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AppError("ORIGIN_NOT_ALLOWED", "Origine de la requête non autorisée.");
  }
  if (parsed.host === expectedHost(request)) return;
  const allowed = config.allowedOrigins.some((o) => {
    try {
      return new URL(o).origin === parsed.origin;
    } catch {
      return false;
    }
  });
  if (!allowed) throw new AppError("ORIGIN_NOT_ALLOWED", "Origine de la requête non autorisée.");
}

/** À appeler sur les routes qui émettent du trafic sortant. Ne fait rien si BOT_PROTECTION=off. */
export function assertHuman(request: Request, ip: string, config: BotConfig, nowMs = Date.now()): void {
  if (config.mode === "off") return;
  assertSameOrigin(request, config);
  const result = verifyPass(config, readCookie(request, PASS_COOKIE), ip, nowMs);
  if (result !== "valid") {
    logger.debug("Défi anti-robot requis", { reason: result });
    throw new AppError("CHALLENGE_REQUIRED", "Une vérification anti-robot est requise.");
  }
}

/* ───────────── Cloudflare Turnstile ───────────── */

const SiteverifySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

/**
 * La destination est une URL fixe en HTTPS (pas une cible choisie par l'utilisateur) :
 * le garde SSRF ne s'applique donc pas ici.
 * Si Cloudflare est injoignable, on refuse (fail closed) au lieu de laisser passer.
 */
export async function verifyTurnstile(
  config: BotConfig,
  token: string,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; errorCodes: string[] }> {
  const unavailable = () => new AppError("UPSTREAM_ERROR", "Le service de vérification est indisponible. Réessaie plus tard.");
  const form = new URLSearchParams({ secret: config.turnstileSecret ?? "", response: token });
  if (isIP(ip)) form.set("remoteip", ip);

  let response: Response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn("Turnstile injoignable", { err });
    throw unavailable();
  }
  if (!response.ok) {
    logger.warn("Turnstile a répondu avec une erreur", { status: response.status });
    throw unavailable();
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw unavailable();
  }
  const parsed = SiteverifySchema.safeParse(data);
  if (!parsed.success) throw unavailable();
  return { ok: parsed.data.success, errorCodes: parsed.data["error-codes"] ?? [] };
}

/* ───────────── Limite des tentatives de vérification ───────────── */

/** Protège le quota de vérification de Cloudflare : 10 tentatives par minute et par réseau. */
export class AttemptLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** true si la tentative est autorisée (et la compte). */
  hit(key: string, nowMs = Date.now()): boolean {
    const cutoff = nowMs - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [k, times] of this.hits) if (times.every((t) => t <= cutoff)) this.hits.delete(k);
    }
    return true;
  }
}

export function getVerifyLimiter(): AttemptLimiter {
  const g = globalThis as { __botVerifyLimiter?: AttemptLimiter };
  g.__botVerifyLimiter ??= new AttemptLimiter(10, 60_000);
  return g.__botVerifyLimiter;
}