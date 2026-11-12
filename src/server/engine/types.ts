import type { HttpRequest, Variables } from "@/shared/schemas";

/** Ce dont le moteur a besoin d'une réponse, quel que soit le transport. */
export interface StepResponse {
  status: number;
  headers: Array<{ key: string; value: string }>;
  /** null si le body est binaire. */
  bodyText: string | null;
  bodyBytes: number;
  durationMs: number;
  finalUrl: string | null;
  truncated: boolean;
}

export interface TransportContext {
  /** Temps restant avant l'échéance globale, null si aucune. */
  timeoutMs: number | null;
  /** Faux si aucune assertion ni extraction ne lit le body : le transport peut alors seulement le vider. */
  needsBody: boolean;
}

/**
 * Envoie une requête. Reçoit la requête NON interpolée et les variables courantes :
 * c'est le transport qui interpole. Lève une AppError en cas d'échec.
 */
export type StepTransport = (
  request: HttpRequest,
  variables: Variables,
  ctx: TransportContext,
) => Promise<StepResponse>;