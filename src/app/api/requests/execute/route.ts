import { withApi } from "@/server/middlewares/with-api";
import { executeRequestController } from "@/server/controllers/requests.controller";
import { ExecuteRequestInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: ExecuteRequestInputSchema }, (input) =>
  executeRequestController(input),
);