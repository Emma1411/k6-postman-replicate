import "server-only";
import { limits } from "@/server/config";
import { executeHttpRequest } from "@/server/services/http-executor";
import type { ExecuteRequestInput } from "@/shared/schemas";

export async function executeRequestController(input: ExecuteRequestInput): Promise<Response> {
  const result = await executeHttpRequest(input, { limits });
  return Response.json(result);
}