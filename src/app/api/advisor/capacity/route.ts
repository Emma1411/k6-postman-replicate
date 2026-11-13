import { capacityController } from "@/server/controllers/advisor.controller";
import { withApi } from "@/server/middlewares/with-api";
import { CapacityInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: CapacityInputSchema }, async (input) => capacityController(input));