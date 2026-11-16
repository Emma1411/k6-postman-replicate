import type { BotVerifyInput } from "@/shared/schemas/bot";
import type { PublicConfig } from "@/shared/types/public-config";
import { apiFetch } from "./client";

export const getConfig = (signal?: AbortSignal) => apiFetch<PublicConfig>("/api/config", { signal });

export interface BotVerifyResult {
  ok: true;
  enabled: boolean;
  expiresAt?: number;
}

export const verifyBot = (input: BotVerifyInput, signal?: AbortSignal) =>
  apiFetch<BotVerifyResult>("/api/bot/verify", { body: input, signal, skipChallenge: true });