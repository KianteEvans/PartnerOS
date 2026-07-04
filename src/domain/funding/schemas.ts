import { z } from "zod";

/** AWS Funding submission payload schemas. Generic helpers live in @/domain/forms. */

const amount = z.coerce.number().int().min(0).max(100_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);

const optionalUuid = z
  .preprocess((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined), z.string().uuid().optional())
  .transform((v) => v ?? null);

const fundingKindEnum = z.enum(["cash", "credits"]);

export const createSubmissionSchema = z.object({
  programKey: z.string().trim().min(1, "Program is required").max(120),
  title: z.string().trim().min(1, "Title is required").max(200),
  fundingType: fundingKindEnum,
  requestedAmount: amount,
  workloadType: z.string().trim().max(40).default(""),
  customerSegment: z.string().trim().max(40).default(""),
  opportunityId: optionalUuid,
  deadline: optionalIsoDate,
  externalRef: z.string().trim().max(200).default(""),
});

/** Editing a draft — same fields, but the program is fixed. */
export const updateSubmissionSchema = createSubmissionSchema.omit({ programKey: true });

export const submissionIdSchema = z.object({ submissionId: z.string().uuid() });

export const approveSchema = z.object({
  approvedAmount: amount,
  notes: z.string().trim().max(2000).default(""),
});

export const notesSchema = z.object({ notes: z.string().trim().max(2000).default("") });
