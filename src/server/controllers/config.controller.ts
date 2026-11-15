import fs from "node:fs";
import path from "node:path";
import { env, limits } from "@/server/config";
import { buildPublicConfig } from "@/server/config/public-config";

export function getConfigController(): Response {
  const workerReady = fs.existsSync(path.resolve(process.cwd(), limits.load.workerPath));
  return Response.json(buildPublicConfig(env, limits, workerReady));
}