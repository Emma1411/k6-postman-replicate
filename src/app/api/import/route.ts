import { importController } from "@/server/controllers/import.controller";
import { withApi } from "@/server/middlewares/with-api";
import { ImportInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: ImportInputSchema }, async (input) => importController(input));