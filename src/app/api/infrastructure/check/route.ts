
import "server-only";

import { withApi } from "@/server/middlewares/with-api";
import { limits } from "@/server/config";
import { PrometheusConnectionSchema } from "@/shared/schemas";
import { checkConnection } from "@/server/services/prometheus/client";
import { AppError } from "@/server/utils/errors";

export const POST = withApi(
  { schema: PrometheusConnectionSchema },
  async (input) => {
    try {
      const result = await checkConnection(
        {
          baseUrl: input.baseUrl,
          auth: input.auth,
        },
        { limits },
      );

      return Response.json(result);
    } catch (error) {
      if (error instanceof AppError) {
        return Response.json(
          { error: error.message },
          { status: 502 },
        );
      }

      throw error;
    }
  },
);
