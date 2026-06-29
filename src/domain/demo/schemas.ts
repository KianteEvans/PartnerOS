import { z } from "zod";

/** "Book a demo" payload (public marketing form). Generic helpers live in @/domain/forms. */

const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
      z.string().max(max).optional(),
    )
    .transform((v) => v ?? null);

export const teamSizeEnum = z.enum(["1-10", "11-50", "51-200", "201-1000", "1000+"]);

const optionalTeamSize = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    teamSizeEnum.optional(),
  )
  .transform((v) => v ?? null);

export const demoRequestSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().min(1, "Please enter your work email").email("Enter a valid email address").max(200),
  company: z.string().trim().min(1, "Please enter your company").max(160),
  teamSize: optionalTeamSize,
  message: optionalText(2000),
});

export type DemoRequestInput = z.infer<typeof demoRequestSchema>;
