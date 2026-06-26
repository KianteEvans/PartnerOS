import { z } from "zod";

/** MDF payload schemas. Generic helpers live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const amount = z.coerce.number().int().min(0).max(100_000_000);

export const activityTypeEnum = z.enum(["event", "campaign", "content", "enablement", "other"]);

const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);

const optionalText = z
  .preprocess((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined), z.string().max(200).optional())
  .transform((v) => v ?? null);

export const createRequestSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  activityType: activityTypeEnum,
  requestedAmount: amount,
  expectedPipeline: amount,
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  claimDeadline: optionalIsoDate,
  opportunityRef: optionalText,
});

export const requestIdSchema = z.object({
  requestId: z.string().uuid(),
});

/** A positive whole-dollar amount for a lifecycle transition. */
export const positiveAmount = z.coerce.number().int().min(1).max(100_000_000);

export { isoDate, amount };
