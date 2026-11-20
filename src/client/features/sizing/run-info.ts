import type { StoredLoadResult } from "@/client/storage/db";

/** Le début du test. Pour un résultat plus ancien sans cette information : la fin moins la durée. */
export function resultStartedAtMs(stored: Pick<StoredLoadResult, "startedAt" | "savedAt" | "result">): number {
  return stored.startedAt ?? stored.savedAt - Math.round(stored.result.durationSeconds * 1000);
}