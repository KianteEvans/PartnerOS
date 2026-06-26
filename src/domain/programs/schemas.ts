import { z } from "zod";

/** Program Management payload schemas. Generic helpers live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

export const adoptProgramSchema = z.object({
  libraryKey: z.string().min(1).max(100),
});

export const programIdSchema = z.object({
  programId: z.string().uuid(),
});

export const requirementIdSchema = z.object({
  requirementId: z.string().uuid(),
});

export const programStatusEnum = z.enum(["pending", "active", "expired"]);
export const requirementStatusEnum = z.enum(["open", "met", "blocked"]);

export { isoDate };
