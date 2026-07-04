import { z } from "zod";

/**
 * Reciprocal benchmarking opt-in. A single boolean toggled from Settings; the
 * checkbox arrives as "on"/absent, so coerce like the other workspace toggles.
 */
export const setBenchmarkParticipationSchema = z.object({
  participating: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export type SetBenchmarkParticipationInput = z.infer<typeof setBenchmarkParticipationSchema>;
