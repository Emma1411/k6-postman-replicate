import type { Assertion, Auth, HttpMethod, HttpRequest, KeyValue, SendRequestInput } from "@/shared/schemas";

export type BodyKind = "none" | "json" | "xml" | "raw" | "urlencoded" | "form-data";

export interface BodyDraft {
  kind: BodyKind;
  /** JSON, XML ou texte brut. */
  content: string;
  /** Type de contenu du texte brut. */
  contentType: string;
  /** urlencoded et form-data (champs texte). */
  fields: KeyValue[];
}

/** L'état de l'éditeur : ce que l'utilisateur voit, pas exactement ce que le serveur reçoit. */
export interface RequestDraft {
  name: string;
  method: HttpMethod;
  /** URL complète, requête incluse. Les paramètres actifs y sont toujours reflétés. */
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: BodyDraft;
  auth: Auth;
  assertions: Assertion[];
  timeoutMs: number | null;
  followRedirects: boolean;
}

export const emptyBody = (): BodyDraft => ({ kind: "none", content: "", contentType: "text/plain", fields: [] });

export function emptyDraft(): RequestDraft {
  return {
    name: "",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: emptyBody(),
    auth: { type: "none" },
    assertions: [],
    timeoutMs: null,
    followRedirects: true,
  };
}

const active = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key.trim() !== "");

function toBody(body: BodyDraft): HttpRequest["body"] {
  switch (body.kind) {
    case "json":
      return { type: "json", content: body.content };
    case "xml":
      return { type: "xml", content: body.content };
    case "raw":
      return { type: "raw", content: body.content, contentType: body.contentType.trim() || "text/plain" };
    case "urlencoded":
      return { type: "urlencoded", fields: active(body.fields) };
    case "form-data":
      return {
        type: "form-data",
        fields: active(body.fields).map((f) => ({ kind: "text" as const, key: f.key, value: f.value, enabled: true })),
      };
    default:
      return { type: "none" };
  }
}

/** Ce que le serveur reçoit. Les paramètres sont déjà dans l'URL : on ne les envoie pas deux fois. */
export function toHttpRequest(draft: RequestDraft): HttpRequest {
  return {
    name: draft.name.trim() || undefined,
    method: draft.method,
    url: draft.url.trim(),
    params: [],
    headers: active(draft.headers),
    body: toBody(draft.body),
    auth: draft.auth,
    timeoutMs: draft.timeoutMs ?? undefined,
    followRedirects: draft.followRedirects,
  };
}

export function draftToSendInput(draft: RequestDraft, variables: Record<string, string>): SendRequestInput {
  return { request: toHttpRequest(draft), variables, assertions: draft.assertions };
}


const needsValue = (operator: string) => operator !== "exists" && operator !== "notExists";

/** Le serveur refuse une assertion incomplète : on le dit avant l'envoi. */
export function validateAssertions(assertions: Assertion[]): string | null {
  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i];
    const where = `Assertion ${i + 1}`;

    switch (a.type) {
      case "responseTime":
        if (!(a.valueMs > 0)) return `${where} : saisis un temps supérieur à 0 ms.`;
        break;

      case "header":
        if (!a.headerName.trim()) return `${where} : saisis le nom de l'en-tête.`;
        if (needsValue(a.operator) && !a.value) return `${where} : saisis la valeur attendue.`;
        break;

      case "jsonPath":
        if (!a.path.trim()) return `${where} : saisis un chemin JSONPath, par exemple $.data.id.`;
        if (needsValue(a.operator) && a.value === undefined) return `${where} : saisis la valeur attendue.`;
        break;

      case "bodyContains":
        if (!a.value) return `${where} : saisis le texte à chercher dans la réponse.`;
        break;

      default:
        break;
    }
  }

  return null;
}


/** Premier contrôle côté navigateur, avant d'appeler le serveur. */

/** Premier contrôle côté navigateur, avant d'appeler le serveur. */
export function validateDraft(draft: RequestDraft): string | null {
  const url = draft.url.trim();

  if (!url) return "Saisis une adresse à appeler.";

  if (!/^(https?:\/\/|\{\{)/i.test(url)) {
    return "L'adresse doit commencer par http:// ou https://, ou par une variable comme {{base_url}}.";
  }

  return validateAssertions(draft.assertions);
}


/** Vérifie qu'un brouillon relu depuis le stockage a la forme attendue. */
export function isRequestDraft(value: unknown): value is RequestDraft {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.name === "string" &&
    typeof d.method === "string" &&
    typeof d.url === "string" &&
    Array.isArray(d.params) &&
    Array.isArray(d.headers) &&
    typeof d.body === "object" &&
    d.body !== null &&
    typeof d.auth === "object" &&
    d.auth !== null &&
    Array.isArray(d.assertions) &&
    typeof d.followRedirects === "boolean"
  );
}

/** Libellé court pour l'historique. */
export const draftLabel = (draft: RequestDraft): string => `${draft.method} ${draft.url}`.slice(0, 120);