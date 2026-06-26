import { z } from "zod";
import {
  INDUSTRY_OPTIONS,
  PARTNER_TYPE_OPTIONS,
  AWS_STAGE_OPTIONS,
  TEAM_SIZE_OPTIONS,
} from "@/domain/onboarding/catalog";

/** Onboarding payload schemas. Generic ActionState/parseOrThrow live in @/domain/forms. */

const inOptions = (opts: readonly string[]) =>
  z.string().refine((v) => opts.includes(v), "Invalid selection");

export const contextSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  industry: inOptions(INDUSTRY_OPTIONS),
  partnerType: inOptions(PARTNER_TYPE_OPTIONS),
  awsStage: inOptions(AWS_STAGE_OPTIONS),
  teamSize: inOptions(TEAM_SIZE_OPTIONS),
});

export const pathSchema = z.object({
  path: z.enum(["foundations", "growth", "scale"]),
});

export const backStepSchema = z.object({
  step: z.enum(["context", "objectives", "path", "review"]),
});

export type ContextInput = z.infer<typeof contextSchema>;
