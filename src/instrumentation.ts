
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { installShutdownHandler } = await import(
    "./server/engine/runs/shutdown"
  );

  installShutdownHandler();

  const { env } = await import("./server/config");
  const { logger } = await import("./server/utils/logger");

  if (
    env.NODE_ENV === "production" &&
    env.DEPLOYMENT_MODE === "public" &&
    env.BOT_PROTECTION === "off"
  ) {
    logger.warn(
      "Instance publique sans protection anti-robot (BOT_PROTECTION=off).",
    );
  }
}
