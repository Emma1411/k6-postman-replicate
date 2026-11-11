import { withApi } from "@/server/middlewares/with-api";
import { runWorkflowController } from "@/server/controllers/workflows.controller";
import { RunWorkflowInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: RunWorkflowInputSchema }, (input, ctx) =>
  runWorkflowController(input, ctx.request.signal),
);