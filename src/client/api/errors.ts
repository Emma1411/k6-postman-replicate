export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "LIMIT_EXCEEDED",
  "SSRF_BLOCKED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "TIMEOUT",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
  "PAYLOAD_TOO_LARGE",
  "CHALLENGE_REQUIRED",
  "CHALLENGE_FAILED",
  "ORIGIN_NOT_ALLOWED",
  "NETWORK_ERROR", // aucune réponse du serveur
  "ABORTED", // annulé côté client
  "UNKNOWN",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const KNOWN = new Set<string>(API_ERROR_CODES);
export const isApiErrorCode = (value: unknown): value is ApiErrorCode =>
  typeof value === "string" && KNOWN.has(value);

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, status = 0, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const COPY: Partial<Record<ApiErrorCode, { title: string; hint: string }>> = {
  SSRF_BLOCKED: {
    title: "Cette adresse n'est pas accessible depuis ce service",
    hint: "Le service public refuse les adresses privées ou internes (localhost, 192.168.x.x, réseaux d'entreprise). Utilise une adresse publique, ou lance ta propre instance.",
  },
  RATE_LIMITED: { title: "Trop de requêtes", hint: "Attends quelques secondes avant de réessayer." },
  LIMIT_EXCEEDED: {
    title: "Ce test dépasse les limites de l'instance",
    hint: "Réduis la charge ou la durée, ou consulte les limites sur la page d'accueil.",
  },
  VALIDATION_ERROR: { title: "Les données envoyées sont invalides", hint: "Corrige le champ indiqué et réessaie." },
  PAYLOAD_TOO_LARGE: { title: "Le contenu envoyé est trop volumineux", hint: "Réduis la taille du corps de la requête." },
  TIMEOUT: { title: "Le délai a été dépassé", hint: "Le serveur cible a mis trop de temps à répondre." },
  UPSTREAM_ERROR: {
    title: "Le serveur cible n'a pas répondu correctement",
    hint: "Vérifie l'adresse, le certificat et que le service est démarré.",
  },
  CHALLENGE_REQUIRED: { title: "Vérification anti-robot requise", hint: "Valide le contrôle pour continuer." },
  CHALLENGE_FAILED: { title: "La vérification anti-robot a échoué", hint: "Réessaie le contrôle." },
  ORIGIN_NOT_ALLOWED: {
    title: "Origine non autorisée",
    hint: "Cette requête vient d'un autre site que celui du service.",
  },
  NETWORK_ERROR: { title: "Impossible de joindre le serveur", hint: "Vérifie ta connexion, puis réessaie." },
  NOT_FOUND: { title: "Introuvable", hint: "La ressource n'existe pas ou a expiré." },
  INTERNAL_ERROR: { title: "Erreur interne du service", hint: "Réessaie dans un instant." },
  ABORTED: { title: "Opération annulée", hint: "" },
};

function violationsOf(details: unknown): string[] {
  if (typeof details !== "object" || details === null) return [];
  const list = (details as { violations?: unknown }).violations;
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
}

/** Titre, conseil et détail à afficher pour n'importe quelle erreur. */
export function describeError(err: unknown): { title: string; hint: string | null; detail: string } {
  if (err instanceof ApiError) {
    const copy = COPY[err.code];
    const violations = err.code === "LIMIT_EXCEEDED" ? violationsOf(err.details) : [];
    return {
      title: copy?.title ?? "Une erreur est survenue",
      hint: copy?.hint || null,
      detail: violations.length > 0 ? `${err.message} ${violations.join(" ; ")}` : err.message,
    };
  }
  return {
    title: "Une erreur est survenue",
    hint: null,
    detail: err instanceof Error ? err.message : "Erreur inconnue.",
  };
}