import { withApi } from "@/server/middlewares/with-api";
import { BotVerifyInputSchema } from "@/shared/schemas/bot";
import { verifyBotController } from "@/server/controllers/bot.controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(
  { schema: BotVerifyInputSchema },
  async (input, ctx) => verifyBotController(input, ctx),
);