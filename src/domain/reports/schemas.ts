import { z } from "zod";

/** Reporting payload schemas. Generic helpers live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

export const reportTypeEnum = z.enum([
  "executive_plan",
  "qbr",
  "mdf_performance",
  "ace_contribution",
  "program_readiness",
  "tier_evidence",
  "custom",
]);

const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);

export const generateReportSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  reportType: reportTypeEnum,
  periodStart: optionalIsoDate,
  periodEnd: optionalIsoDate,
});

export const reportIdSchema = z.object({ reportId: z.string().uuid() });
