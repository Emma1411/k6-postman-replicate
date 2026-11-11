import "server-only";
import type { Auth, HttpMethod, HttpRequest, RequestBody } from "@/shared/schemas";
import type { Limits } from "@/server/config/limits";
import { AppError } from "@/server/utils/errors";

export interface BuiltRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>; // noms en minuscules
  body: Buffer | null;
}

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const FORBIDDEN_HEADERS = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
  "proxy-connection",
]);
const NO_BODY_METHODS = new Set<HttpMethod>(["GET", "HEAD"]);

function assertHeader(name: string, value: string): void {
  if (!HEADER_NAME.test(name)) {
    throw new AppError("VALIDATION_ERROR", `Nom de header invalide : "${name}".`);
  }
  if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
    throw new AppError("VALIDATION_ERROR", `Le header "${name}" est géré automatiquement et ne peut pas être défini.`);
  }
  if (!HEADER_VALUE.test(value)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Valeur invalide pour le header "${name}" (retour à la ligne ou caractère non autorisé).`,
    );
  }
}

function applyAuth(auth: Auth, headers: Map<string, string>, url: URL): void {
  switch (auth.type) {
    case "none":
      return;
    case "basic": {
      const token = Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64");
      headers.set("authorization", `Basic ${token}`);
      return;
    }
    case "bearer": {
      const value = `Bearer ${auth.token}`;
      assertHeader("authorization", value);
      headers.set("authorization", value);
      return;
    }
    case "apiKey": {
      if (auth.in === "query") {
        url.searchParams.append(auth.key, auth.value);
      } else {
        assertHeader(auth.key, auth.value);
        headers.set(auth.key.toLowerCase(), auth.value);
      }
      return;
    }
  }
}

async function encodeBody(body: RequestBody): Promise<{ body: Buffer | null; contentType: string | null }> {
  switch (body.type) {
    case "none":
      return { body: null, contentType: null };
    case "json":
      return { body: Buffer.from(body.content, "utf8"), contentType: "application/json" };
    case "xml":
      return { body: Buffer.from(body.content, "utf8"), contentType: "application/xml" };
    case "raw":
      return { body: Buffer.from(body.content, "utf8"), contentType: body.contentType };
    case "urlencoded": {
      const params = new URLSearchParams();
      for (const field of body.fields) if (field.enabled) params.append(field.key, field.value);
      return { body: Buffer.from(params.toString(), "utf8"), contentType: "application/x-www-form-urlencoded" };
    }
    case "form-data": {
      const form = new FormData();
      for (const field of body.fields) {
        if (!field.enabled) continue;
        if (field.kind === "text") {
          form.append(field.key, field.value);
        } else {
          const bytes = new Uint8Array(Buffer.from(field.base64, "base64"));
          form.append(field.key, new Blob([bytes], { type: field.contentType }), field.filename);
        }
      }
      // Response sérialise le FormData en multipart et fournit le Content-Type avec la boundary.
      const serialized = new Response(form);
      return {
        body: Buffer.from(await serialized.arrayBuffer()),
        contentType: serialized.headers.get("content-type"),
      };
    }
    case "binary":
      return { body: Buffer.from(body.base64, "base64"), contentType: body.contentType };
  }
}

export async function buildRequest(req: HttpRequest, limits: Limits["http"]): Promise<BuiltRequest> {
  if (NO_BODY_METHODS.has(req.method) && req.body.type !== "none") {
    throw new AppError("VALIDATION_ERROR", `Les requêtes ${req.method} ne peuvent pas avoir de body.`);
  }

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw new AppError("VALIDATION_ERROR", "URL invalide (vérifie le protocole et les variables).");
  }
  for (const param of req.params) if (param.enabled) url.searchParams.append(param.key, param.value);

  const headers = new Map<string, string>([
    ["user-agent", "ApiEngineeringPlatform/1.0"],
    ["accept", "*/*"],
    ["accept-encoding", "gzip, deflate, br"],
  ]);
  applyAuth(req.auth, headers, url);
  // Les headers définis par l'utilisateur l'emportent sur les valeurs par défaut et sur l'auth.
  for (const header of req.headers) {
    if (!header.enabled) continue;
    assertHeader(header.key, header.value);
    headers.set(header.key.toLowerCase(), header.value);
  }

  const { body, contentType } = await encodeBody(req.body);
  if (body !== null) {
    if (body.length > limits.maxRequestBodyBytes) {
      throw new AppError("PAYLOAD_TOO_LARGE", "Le body de la requête cible dépasse la taille maximale.", {
        maxBytes: limits.maxRequestBodyBytes,
      });
    }
    // Pour form-data, la boundary est liée au body : on ignore le Content-Type de l'utilisateur.
    if (contentType && (req.body.type === "form-data" || !headers.has("content-type"))) {
      headers.set("content-type", contentType);
    }
    headers.set("content-length", String(body.length));
  }

  return { method: req.method, url: url.href, headers: Object.fromEntries(headers), body };
}