import "server-only";
import { env } from "./env";
import { buildLimits } from "./limits";

export { env };
export const limits = buildLimits(env);
export type { Limits } from "./limits";