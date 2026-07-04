import { z } from "zod";

/** Private-offer payload schemas. Generic helpers live in @/domain/forms. */

const amount = z.coerce.number().int().min(0).max(100_000_000);
const pct = z.coerce.number().int().min(0).max(100);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);

const optionalUuid = z
  .preprocess((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined), z.string().uuid().optional())
  .transform((v) => v ?? null);

export const createPrivateOfferSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  opportunityId: optionalUuid,
  listingId: optionalUuid,
  customerIdentifier: z.string().trim().max(200).default(""),
  customerName: z.string().trim().max(200).default(""),
  offerValue: amount,
  discountPct: pct.default(0),
  currency: z.string().trim().max(8).default("USD"),
  expirationDate: optionalIsoDate,
  notes: z.string().trim().max(2000).default(""),
});

/** Editing a draft — same fields. */
export const updatePrivateOfferSchema = createPrivateOfferSchema;

export const offerIdSchema = z.object({ offerId: z.string().uuid() });

export const offerStatusSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "declined", "expired", "withdrawn"]),
});
