import { z } from "zod";

/**
 * Zod payload schemas for task mutations. The generic ActionState / parseOrThrow
 * live in @/domain/forms.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

const priority = z.enum(["low", "medium", "high", "critical"]);

/** Open-state transitions only; completion goes through the complete action. */
export const openStatus = z.enum(["open", "in_progress", "blocked"]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.preprocess(
    (v) => (typeof v === "string" ? v : ""),
    z.string().max(2000),
  ),
  priority: z.preprocess(
    (v) => (v === "" || v == null ? "medium" : v),
    priority,
  ),
  dueDate: z
    .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
    .transform((v) => v ?? null),
});

export const taskIdSchema = z.object({
  taskId: z.string().uuid(),
});

export type CreateTaskValues = z.infer<typeof createTaskSchema>;
