import { analyzeController } from "@/server/controllers/advisor.controller";
import { withApi } from "@/server/middlewares/with-api";
import { AnalyzeInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: AnalyzeInputSchema }, async (input) => analyzeController(input));