import { z } from "zod";

/** Partner Tier payload schemas. Generic helpers live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

export const createPlanSchema = z.object({
  targetTier: z.enum(["select", "advanced", "premier"]),
});

export const planIdSchema = z.object({
  planId: z.string().uuid(),
});

export const requirementIdSchema = z.object({
  requirementId: z.string().uuid(),
});

export { isoDate };
