import { z } from "zod";
import { isoDate, amount } from "@/domain/mdf/schemas";

/** Zod schemas for the MDF event planner (plans + candidate items). */

const optionalIsoDate = z
  .preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional())
  .transform((v) => v ?? null);

const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
      z.string().max(max).optional(),
    )
    .transform((v) => v ?? null);

const coFundPct = z.preprocess(
  (v) => (v === "" || v == null ? 50 : v),
  z.coerce.number().int().min(0).max(100),
);

export const planSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  notes: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(2000))
    .transform((v) => v ?? ""),
});

export const planItemSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(4000)),
  catalogKey: optionalText(80),
  totalCost: amount,
  coFundPct,
  expectedPipeline: amount,
  expectedOpportunities: z.coerce.number().int().min(0).max(1_000_000),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  spmsId: optionalText(120),
});

export const planIdSchema = z.object({ planId: z.string().uuid() });
export const itemIdSchema = z.object({ itemId: z.string().uuid() });
