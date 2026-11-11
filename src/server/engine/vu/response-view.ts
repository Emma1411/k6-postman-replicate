import "server-only";
import type { StepResponse } from "@/server/engine/types";

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Vue d'une réponse avec parsing JSON paresseux et mis en cache (une seule analyse par étape). */
export class ResponseView {
  readonly response: StepResponse;
  private parsed: JsonParseResult | null = null;

  constructor(response: StepResponse) {
    this.response = response;
  }

  json(): JsonParseResult {
    if (this.parsed) return this.parsed;
    const { bodyText, truncated } = this.response;

    if (bodyText === null) {
      this.parsed = { ok: false, error: "Le body est binaire : impossible de l'analyser comme JSON." };
    } else if (truncated) {
      this.parsed = {
        ok: false,
        error: "Le body a été tronqué (taille maximale atteinte) : impossible de l'analyser comme JSON.",
      };
    } else if (bodyText.trim() === "") {
      this.parsed = { ok: false, error: "Le body est vide : JSON attendu." };
    } else {
      try {
        this.parsed = { ok: true, value: JSON.parse(bodyText) };
      } catch {
        this.parsed = { ok: false, error: "Le body n'est pas du JSON valide." };
      }
    }
    return this.parsed;
  }

  headers(name: string): string[] {
    const lower = name.toLowerCase();
    return this.response.headers.filter((h) => h.key.toLowerCase() === lower).map((h) => h.value);
  }

  header(name: string): string | null {
    return this.headers(name)[0] ?? null;
  }
}