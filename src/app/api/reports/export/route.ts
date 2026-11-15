import { exportReportController } from "@/server/controllers/reports.controller";
import { withApi } from "@/server/middlewares/with-api";
import { ReportExportInputSchema } from "@/shared/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ schema: ReportExportInputSchema }, async (input) => exportReportController(input));