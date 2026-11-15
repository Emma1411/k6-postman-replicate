import { logger } from "@/server/utils/logger";
import { peekRegistry, type RunRegistry } from "./run-registry";

export async function shutdown(registry: RunRegistry | undefined, timeoutMs = 5000): Promise<void> {
  if (!registry) return;
  const cancelled = registry.cancelAll("Arrêt du serveur : test interrompu.");
  if (cancelled === 0) return;
  logger.warn("Arrêt du serveur : tests de charge annulés", { cancelled });
  const idle = await registry.waitForIdle(timeoutMs);
  if (!idle) logger.warn("Arrêt du serveur : certains tests ne se sont pas terminés à temps");
}

const FLAG = "__shutdownHandlerInstalled";

export function installShutdownHandler(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return; // évite les doublons (rechargement à chaud)
  g[FLAG] = true;
  const handler = (signal: string) => {
    logger.info("Signal d'arrêt reçu", { signal });
    void shutdown(peekRegistry()).finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => handler("SIGTERM"));
  process.once("SIGINT", () => handler("SIGINT"));
}