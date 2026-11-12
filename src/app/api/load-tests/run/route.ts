import { withApi } from "@/server/middlewares/with-api";
import { startLoadTestController } from "@/server/controllers/load-tests.controller";
import { RunLoadTestInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: RunLoadTestInputSchema, rateLimit: "loadRuns" }, async (input, ctx) =>
  startLoadTestController(input, ctx.request.signal),
);