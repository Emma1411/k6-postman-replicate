import { z } from "zod";

export const BotVerifyInputSchema = z.object({
  token: z.string().min(1).max(2048),
});
export type BotVerifyInput = z.infer<typeof BotVerifyInputSchema>;