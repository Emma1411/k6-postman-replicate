import { apiFetch } from "@/client/api/client";
import type { planCapacity } from "@/shared/advisor/capacity/plan";
import type { CapacityInput } from "@/shared/schemas";

/** Le résultat de la planification, tel que le calcule le serveur. */
export type CapacityResult = Awaited<ReturnType<typeof planCapacity>>;

export const requestCapacity = (input: CapacityInput, signal?: AbortSignal) =>
  apiFetch<CapacityResult>("/api/advisor/capacity", { body: input, signal });