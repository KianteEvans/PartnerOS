import { z } from "zod";

/** Roadmap payload schemas. Generic ActionState/parseOrThrow live in @/domain/forms. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

export const createRoadmapSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  objective: z.preprocess(
    (v) => (typeof v === "string" ? v : ""),
    z.string().max(500),
  ),
  horizon: z.enum(["m3", "m6", "m9", "m12", "m18"]),
  scenario: z.enum(["conservative", "standard", "accelerated"]),
  startDate: isoDate,
  sourceAssessmentId: z
    .preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().uuid().optional(),
    )
    .transform((v) => v ?? null),
});

/**
 * Composed roadmap: the customer selects programs + a target tier in the builder
 * and the milestone plan is assembled from the catalogs. programKeys arrive as a
 * comma-joined string and owners as a JSON map (composed-milestone key -> userId)
 * from the client island's hidden fields.
 */
export const composedRoadmapSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  objective: z.preprocess(
    (v) => (typeof v === "string" ? v : ""),
    z.string().max(500),
  ),
  horizon: z.enum(["m3", "m6", "m9", "m12", "m18"]),
  scenario: z.enum(["conservative", "standard", "accelerated"]),
  startDate: isoDate,
  programKeys: z.preprocess(
    (v) =>
      typeof v === "string" && v.length > 0
        ? v.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    z.array(z.string().max(64)).max(32),
  ),
  targetTier: z
    .preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.enum(["registered", "select", "advanced", "premier"]).nullable(),
    ),
  owners: z.preprocess((v) => {
    if (typeof v !== "string" || v.length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, z.record(z.string())),
});

export const roadmapIdSchema = z.object({
  roadmapId: z.string().uuid(),
});

export const milestoneIdSchema = z.object({
  milestoneId: z.string().uuid(),
});

// ----- increment 2: living-plan editing -----

export const milestoneStatusValues = z.enum([
  "planned",
  "in_progress",
  "done",
  "blocked",
]);

export const setMilestoneStatusSchema = z.object({
  milestoneId: z.string().uuid(),
  status: milestoneStatusValues,
});

export const reorderMilestonesSchema = z.object({
  roadmapId: z.string().uuid(),
  orderedIds: z.preprocess(
    (v) =>
      typeof v === "string" && v.length > 0
        ? v.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    z.array(z.string().uuid()).min(1).max(64),
  ),
});

export const addMilestoneSchema = z.object({
  roadmapId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(200),
  detail: z.preprocess(
    (v) => (typeof v === "string" ? v : ""),
    z.string().max(500),
  ),
  targetDate: isoDate,
  ownerUserId: z
    .preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.string().uuid().optional(),
    )
    .transform((v) => v ?? null),
});

export const recomposeRoadmapSchema = z.object({
  roadmapId: z.string().uuid(),
  programKeys: z.array(z.string().max(64)).max(32),
  targetTier: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.enum(["registered", "select", "advanced", "premier"]).nullable(),
  ),
});

export const replanRoadmapSchema = z.object({
  roadmapId: z.string().uuid(),
  horizon: z.enum(["m3", "m6", "m9", "m12", "m18"]),
  scenario: z.enum(["conservative", "standard", "accelerated"]),
  startDate: isoDate,
});

export { isoDate };
