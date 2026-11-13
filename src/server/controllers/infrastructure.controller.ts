import "server-only";
import { limits } from "@/server/config";
import { checkConnection } from "@/server/services/prometheus/client";
import { queryInfrastructure } from "@/server/services/prometheus/infrastructure";
import type { PrometheusConnectionInput, PrometheusQueryInput } from "@/shared/schemas";

export async function queryInfrastructureController(input: PrometheusQueryInput): Promise<Response> {
  return Response.json(await queryInfrastructure(input, { limits }));
}

export async function checkPrometheusController(input: PrometheusConnectionInput): Promise<Response> {
  return Response.json(await checkConnection(input, { limits }));
}