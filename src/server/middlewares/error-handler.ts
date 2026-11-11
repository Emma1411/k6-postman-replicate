import "server-only";
import { AppError } from "@/server/utils/errors";

export function toErrorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    const headers = new Headers();
    if (err.code === "RATE_LIMITED") {
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) headers.set("Retry-After", String(retry));
    }
    return Response.json(err.toJSON(), { status: err.status, headers });
  }

  console.error("[api] erreur inattendue", err);
  return Response.json(new AppError("INTERNAL_ERROR", "Erreur interne du serveur.").toJSON(), { status: 500 });
}