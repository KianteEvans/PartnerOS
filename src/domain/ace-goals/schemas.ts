import { z } from "zod";
import { isMetricKey } from "@/domain/ace-goals/catalog";

/** Co-Selling Goal payload schemas. Generic helpers live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);

export const goalStatusEnum = z.enum(["active", "archived"]);

export const createAceGoalSchema = z
  .object({
    metricKey: z.string().refine(isMetricKey, "Unknown metric"),
    // bigint column; cap well under 2^53 so the number stays exact.
    targetValue: z.coerce.number().int().min(1, "Target must be at least 1").max(1_000_000_000_000),
    periodStart: isoDate,
    targetDeadline: optionalIsoDate,
  })
  .refine((v) => v.targetDeadline === null || v.targetDeadline >= v.periodStart, {
    message: "Deadline must be on or after the tracking start",
    path: ["targetDeadline"],
  });

export const goalIdSchema = z.object({ goalId: z.string().uuid() });

export type CreateAceGoalInput = z.infer<typeof createAceGoalSchema>;
