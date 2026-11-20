import { env } from "@/server/config";
import type { BotVerifyInput } from "@/shared/schemas/bot";
import {
  PASS_COOKIE,
  botConfigFromEnv,
  getVerifyLimiter,
  issuePass,
  networkKey,
  verifyTurnstile,
  type BotConfig,
} from "@/server/middlewares/bot-protection";
import { AppError } from "@/server/utils/errors";
import { logger } from "@/server/utils/logger";



export async function verifyBotController(
  input: BotVerifyInput,
  ctx: { ip: string; request: Request },
  config: BotConfig = botConfigFromEnv(env),
  deps: { fetch?: typeof fetch } = {},
): Promise<Response> {
  if (config.mode === "off") {
    return Response.json({ ok: true, enabled: false });
  }

  if (!getVerifyLimiter().hit(networkKey(ctx.ip))) {
    throw new AppError(
      "RATE_LIMITED",
      "Trop de tentatives de vérification. Réessaie dans une minute.",
    );
  }

  const result = await verifyTurnstile(
    config,
    input.token,
    ctx.ip,
    deps.fetch,
  );

  if (!result.ok) {
    logger.info("Défi anti-robot refusé", {
      errorCodes: result.errorCodes,
    });

    throw new AppError(
      "CHALLENGE_FAILED",
      "La vérification anti-robot a échoué.",
    );
  }

  const { token, expiresAt } = issuePass(config, ctx.ip);

  const https =
    new URL(ctx.request.url).protocol === "https:" ||
    ctx.request.headers.get("x-forwarded-proto") === "https";

  const cookie =
    `${PASS_COOKIE}=${token}; Path=/api; Max-Age=${config.ttlSeconds}; HttpOnly; SameSite=Strict` +
    (https ? "; Secure" : "");

  return new Response(
    JSON.stringify({ ok: true, enabled: true, expiresAt }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie": cookie,
      },
    },
  );
}
