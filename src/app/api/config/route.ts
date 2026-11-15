import { withApiNoBody } from "@/server/middlewares/with-api";
import { getConfigController } from "@/server/controllers/config.controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiNoBody(async () => getConfigController());