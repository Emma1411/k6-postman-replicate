import "server-only";
import { AppError } from "@/server/utils/errors";
import { parseSpecText } from "@/server/services/import/spec-text";
import { importOpenApi } from "@/shared/collections/openapi-import";
import { importPostmanCollection, importPostmanEnvironment } from "@/shared/collections/postman-import";
import { CollectionError, type ImportInput } from "@/shared/schemas";

function toJson(content: ImportInput["content"]): unknown {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new AppError("VALIDATION_ERROR", "Le contenu n'est pas du JSON valide.");
  }
}

export function importController(input: ImportInput): Response {
  try {
    if (input.source === "openapi") {
      const data = typeof input.content === "string" ? parseSpecText(input.content) : input.content;
      const result = importOpenApi(data);
      return Response.json({ source: input.source, collection: result.value, warnings: result.warnings, stats: result.stats });
    }

    const data = toJson(input.content);
    if (input.source === "postman-collection") {
      const result = importPostmanCollection(data);
      return Response.json({ source: input.source, collection: result.value, warnings: result.warnings, stats: result.stats });
    }
    const result = importPostmanEnvironment(data);
    return Response.json({ source: input.source, environment: result.value, warnings: result.warnings });
  } catch (err) {
    if (err instanceof CollectionError) {
      throw new AppError("VALIDATION_ERROR", err.message, err.path ? { path: err.path } : undefined);
    }
    throw err;
  }
}