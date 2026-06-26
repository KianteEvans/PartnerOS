import { z } from "zod";

/**
 * Zod payload schemas for the assessment mutations. Validation happens at the
 * action boundary BEFORE anything is serialized into the gate's rawBody, and a
 * failure becomes a typed ValidationError (422) the UI can surface. The generic
 * ActionState / parseOrThrow live in @/domain/forms and are re-exported here so
 * existing imports keep resolving.
 */
export {
  parseOrThrow,
  IDLE_STATE,
  type ActionState,
} from "@/domain/forms";

export const createAssessmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  preset: z.enum([
    "program_submission",
    "growth_funding",
    "tier_advancement",
    "custom",
  ]),
  targetProgram: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const submitAssessmentSchema = z.object({
  assessmentId: z.string().uuid(),
});

export const reviewRecommendationSchema = z.object({
  recommendationId: z.string().uuid(),
});

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;
