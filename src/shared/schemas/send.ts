import { z } from "zod";
import { ExecuteRequestInputSchema } from "./http";
import { AssertionSchema } from "./workflow";

/** Une requête et, en option, des assertions évaluées sur sa réponse (jusqu'à 50). */
export const SendRequestInputSchema = ExecuteRequestInputSchema.extend({
  assertions: z.array(AssertionSchema).max(50).default([]),
});
export type SendRequestInput = z.infer<typeof SendRequestInputSchema>;