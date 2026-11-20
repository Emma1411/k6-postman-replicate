import { env } from "@/server/config";
import { withApi } from "@/server/middlewares/with-api";
import { assertHuman, botConfigFromEnv } from "@/server/middlewares/bot-protection";
import { startLoadTestController } from "@/server/controllers/load-tests.controller";
import { RunLoadTestInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: RunLoadTestInputSchema, rateLimit: "loadRuns" }, async (input, ctx) => {
  assertHuman(ctx.request, ctx.ip, botConfigFromEnv(env));
  return startLoadTestController(input, ctx.request.signal);
});