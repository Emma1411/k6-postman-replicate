import fs from "node:fs";
import path from "node:path";
import { env, limits } from "@/server/config";
import { buildPublicConfig } from "@/server/config/public-config";
import { peekRegistry } from "@/server/engine/runs/run-registry";


export function getConfigController(): Response {
  const workerReady = fs.existsSync(path.resolve(process.cwd(), limits.load.workerPath));
  const activeRuns = peekRegistry()?.activeCount() ?? 0;
  return Response.json(buildPublicConfig(env, limits, workerReady, activeRuns));
}