import "server-only";
import { limits } from "@/server/config";
import { executeWithAssertions } from "@/server/services/http-executor/with-assertions";
import type { SendRequestInput } from "@/shared/schemas";

export async function executeRequestController(input: SendRequestInput): Promise<Response> {
  return Response.json(await executeWithAssertions(input, { limits }));
}