import { withApiNoBody } from "@/server/middlewares/with-api";
import { getLoadTestController } from "@/server/controllers/load-tests.controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ runId: string }> };

export const GET = withApiNoBody<RouteContext>(async (_ctx, route) => {
  const { runId } = await route.params;
  return getLoadTestController(runId);
});