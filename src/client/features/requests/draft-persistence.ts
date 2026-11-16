import { getSetting, setSetting } from "@/client/storage/repositories";
import { isRequestDraft, type RequestDraft } from "./model";

const KEY = "editor-draft";

/** Le brouillon enregistré, ou null s'il n'existe pas, est invalide, ou si le stockage est indisponible. */
export async function loadSavedDraft(): Promise<RequestDraft | null> {
  try {
    const value = await getSetting<unknown>(KEY, null);
    return isRequestDraft(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveDraft(draft: RequestDraft): Promise<void> {
  try {
    await setSetting(KEY, draft);
  } catch {
    /* stockage indisponible : le brouillon reste en mémoire pour la session */
  }
}