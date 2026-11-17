import { getSetting, setSetting } from "@/client/storage/repositories";
import { isRequestDraft, type RequestDraft } from "./model";

const KEY = "pending-load-target";

export interface LoadHandoff {
  draft: RequestDraft;
  variables: Record<string, string>;
  createdAt: number;
}

export async function saveLoadHandoff(handoff: LoadHandoff): Promise<void> {
  await setSetting(KEY, handoff);
}

/** Lit puis supprime la cible transmise. Elle expire après 10 minutes (étape 9.3 : assistant de charge). */
export async function takeLoadHandoff(maxAgeMs = 10 * 60_000, now = Date.now()): Promise<LoadHandoff | null> {
  const value = await getSetting<unknown>(KEY, null);
  if (value === null) return null;
  await setSetting(KEY, null);
  if (typeof value !== "object") return null;
  const h = value as Record<string, unknown>;
  const fresh = typeof h.createdAt === "number" && now - h.createdAt <= maxAgeMs;
  const variablesOk = typeof h.variables === "object" && h.variables !== null;
  return fresh && variablesOk && isRequestDraft(h.draft) ? (value as LoadHandoff) : null;
}