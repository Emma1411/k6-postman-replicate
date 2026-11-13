import { queryInfrastructureController } from "@/server/controllers/infrastructure.controller";
import { withApi } from "@/server/middlewares/with-api";
import { PrometheusQueryInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: PrometheusQueryInputSchema }, async (input) =>
  queryInfrastructureController(input),
);