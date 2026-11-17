import { ApiError, isApiErrorCode } from "./errors";

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  /** Ne pas déclencher le défi anti-robot ni rejouer la requête. */
  skipChallenge?: boolean;
}

/* ───────── Défi anti-robot ───────── */

type ChallengeHandler = () => Promise<void>;
let challengeHandler: ChallengeHandler | null = null;
let challengeInFlight: Promise<void> | null = null;

/** Enregistré par l'interface (boîte de dialogue). Un seul défi à la fois, partagé entre les requêtes. */
export function setChallengeHandler(handler: ChallengeHandler | null): void {
  challengeHandler = handler;
}

function runChallenge(): Promise<void> {
  if (!challengeHandler) {
    return Promise.reject(new ApiError("CHALLENGE_REQUIRED", "Une vérification anti-robot est requise.", 403));
  }
  challengeInFlight ??= challengeHandler().finally(() => {
    challengeInFlight = null;
  });
  return challengeInFlight;
}

/* ───────── Transport ───────── */

let fetchOverride: typeof fetch | null = null;
/** Pour les tests. */
export function setFetch(fn: typeof fetch | null): void {
  fetchOverride = fn;
}
const send = (input: string, init: RequestInit): Promise<Response> =>
  fetchOverride ? fetchOverride(input, init) : fetch(input, init);

async function toApiError(res: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* corps absent ou non JSON (page d'erreur d'un proxy, par exemple) */
  }
  const error = (payload as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  const code = isApiErrorCode(error?.code) ? error.code : res.status === 429 ? "RATE_LIMITED" : "UNKNOWN";
  const message = typeof error?.message === "string" ? error.message : `Erreur HTTP ${res.status}`;
  return new ApiError(code, message, res.status, error?.details);
}

/**
 * Appelle l'API du service. Lève toujours une ApiError.
 * Sur « CHALLENGE_REQUIRED », lance le défi anti-robot puis rejoue la requête UNE fois.
 */


async function attemptRaw(path: string, options: RequestOptions): Promise<Response> {
  const hasBody = options.body !== undefined;
  let res: Response;
  try {
    res = await send(path, {
      method: options.method ?? (hasBody ? "POST" : "GET"),
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if (options.signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw new ApiError("ABORTED", "Requête annulée.");
    }
    throw new ApiError("NETWORK_ERROR", "Impossible de joindre le serveur.");
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

/** Sur « CHALLENGE_REQUIRED », lance le défi anti-robot puis rejoue UNE fois. */
async function withChallenge<T>(options: RequestOptions, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError && err.code === "CHALLENGE_REQUIRED" && !options.skipChallenge) {
      await runChallenge();
      return run();
    }
    throw err;
  }
}

/** Appelle l'API du service et lit la réponse JSON. Lève toujours une ApiError. */
export function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return withChallenge(options, async () => {
    const res = await attemptRaw(path, options);
    return (await res.json()) as T;
  });
}

/** Comme apiFetch, mais renvoie la réponse brute sans lire son corps (flux SSE). */
export function apiStream(path: string, options: RequestOptions = {}): Promise<Response> {
  return withChallenge(options, () => attemptRaw(path, options));
}