import "server-only";
import type { z } from "zod";
import { AppError } from "@/server/utils/errors";

function tooLarge(maxBytes: number): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", "Corps de requête trop volumineux.", { maxBytes });
}

/** Lit le body en flux et s'arrête dès que la taille maximale est dépassée. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) throw tooLarge(maxBytes);
  }

  if (!request.body) throw new AppError("VALIDATION_ERROR", "Corps de requête manquant.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("VALIDATION_ERROR", "Le corps de la requête n'est pas du JSON valide.");
  }
}

export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new AppError("VALIDATION_ERROR", "Entrée invalide.", { issues });
  }
  return result.data as z.output<S>;
}