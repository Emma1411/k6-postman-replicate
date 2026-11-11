import "server-only";
import { parseEnv, type Env } from "./env.schema";

export const env: Env = parseEnv(process.env);