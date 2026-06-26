import { z } from "zod";

/** Evidence payload schemas. Generic ActionState/parseOrThrow live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

export const evidenceTypeEnum = z.enum([
  "case_study",
  "certification",
  "architecture",
  "security",
  "billing",
  "reference",
  "other",
]);

export const openStatusEnum = z.enum(["missing", "collected", "in_review"]);

const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);

const optionalText = (max: number) =>
  z
    .preprocess((v) => (v === "" || v == null ? undefined : v), z.string().max(max).optional())
    .transform((v) => v ?? null);

export const createEvidenceSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  evidenceType: evidenceTypeEnum,
  program: optionalText(200),
  dueDate: optionalIsoDate,
  expirationDate: optionalIsoDate,
});

export const evidenceIdSchema = z.object({
  evidenceId: z.string().uuid(),
});

export const reviewEvidenceSchema = z.object({
  evidenceId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  qualityScore: z
    .preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z.number().int().min(0).max(100).optional(),
    )
    .transform((v) => v ?? null),
  notes: z.preprocess(
    (v) => (typeof v === "string" ? v : ""),
    z.string().max(2000),
  ),
});

export { isoDate, optionalIsoDate };

/** Max evidence file size accepted through the Server Action upload path. */
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // 10 MB
