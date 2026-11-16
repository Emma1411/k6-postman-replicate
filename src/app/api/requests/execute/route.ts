import { withApi } from "@/server/middlewares/with-api";
import { executeRequestController } from "@/server/controllers/requests.controller";
import { SendRequestInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: SendRequestInputSchema }, (input) => executeRequestController(input));