import type { HttpResponse } from "@/shared/schemas";
import type { AssertionResult } from "./workflow-result";

/** Réponse HTTP complète + résultat des assertions demandées. */
export interface SendRequestResult extends HttpResponse {
  assertions: AssertionResult[];
}