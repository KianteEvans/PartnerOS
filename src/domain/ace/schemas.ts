import { z } from "zod";

/** ACE payload schemas. Generic helpers live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const amount = z.coerce.number().int().min(0).max(100_000_000);

export const stageEnum = z.enum([
  "prospect",
  "qualified",
  "tech_validation",
  "business_validation",
  "committed",
  "launched",
  "closed_lost",
]);
export const statusEnum = z.enum(["open", "won", "lost"]);
// Win/loss capture (drizzle/0051): why a deal was lost; "" = not recorded.
// Keep in sync with LOSS_REASONS in @/domain/ace/winloss.
export const lossReasonEnum = z.enum(["", "competitor", "price", "timing", "no_budget", "scope", "other"]);
export const sourceEnum = z.enum(["partner_originated", "amazon_originated", "marketplace"]);
export const roleEnum = z.enum([
  "seller",
  "solutions_architect",
  "partner_manager",
  "leadership",
  "other",
]);

const optionalText = z
  .preprocess((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined), z.string().max(200).optional())
  .transform((v) => v ?? null);
const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);
const optionalUuid = z
  .preprocess((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined), z.string().uuid().optional())
  .transform((v) => v ?? null);

export const interactionKindEnum = z.enum(["meeting", "email", "call", "qbr", "note"]);

export const createOpportunitySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  accountName: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(200)),
  stage: stageEnum,
  amount,
  source: sourceEnum,
  awsSeller: optionalText,
  awsContactId: optionalUuid,
  closeDate: optionalIsoDate,
});

export const createInteractionSchema = z.object({
  contactId: z.string().uuid(),
  opportunityId: optionalUuid,
  occurredOn: isoDate,
  kind: interactionKindEnum,
  note: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(2000)),
});

export const createRelationshipSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  role: roleEnum,
  accountName: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(200)),
  strength: z.coerce.number().int().min(0).max(100),
  lastContact: optionalIsoDate,
});

export const opportunityIdSchema = z.object({ opportunityId: z.string().uuid() });
export const relationshipIdSchema = z.object({ relationshipId: z.string().uuid() });
export const oppCaseStudySchema = z.object({
  opportunityId: z.string().uuid(),
  caseStudyId: z.string().uuid(),
});

export { isoDate, amount };
