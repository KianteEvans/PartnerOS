import { z } from "zod";

/** Playbook engine payload schemas. Generic form helpers live in @/domain/forms. */

const SITUATIONS = [
  "overdue_work",
  "blocked_work",
  "mdf_deadline",
  "plan_submission_due",
  "aws_review",
  "roadmap_risk",
  "renewal_due",
  "evidence",
  "marketplace_entitlement",
  "marketplace_changeset",
  "marketplace_revenue_gap",
  "aws_sync_stale",
  "aws_sync_drift",
  "funding_deadline",
  "funding_rematch",
  "evidence_expired",
  "stalled_deal",
] as const;

const optionalUuid = z
  .preprocess((v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined), z.string().uuid().optional())
  .transform((v) => v ?? null);

const boolFromForm = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const channels = z
  .preprocess(
    (v) => (Array.isArray(v) ? v : v == null ? [] : [v]),
    z.array(z.enum(["in_app", "email", "webhook"])),
  )
  .transform((a) => (a.length ? Array.from(new Set(a)) : (["in_app"] as ("in_app" | "email" | "webhook")[])));

export const createPlaybookSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).default(""),
  triggerSituation: z.enum(SITUATIONS),
  triggerMinSeverity: z.enum(["critical", "high", "medium"]).default("medium"),
  actionType: z.enum(["create_task", "route_opportunity", "approve_within_cap", "generate_report", "notify"]),
  // Action params (only the relevant ones are read per action type).
  title: z.string().trim().max(200).default(""),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  ownerUserId: optionalUuid,
  cap: z.coerce.number().int().min(0).max(100_000_000).default(0),
  channels,
});

export const updatePlaybookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  triggerMinSeverity: z.enum(["critical", "high", "medium"]).default("medium"),
  channels,
});

export const playbookIdSchema = z.object({ playbookId: z.string().uuid() });
export const togglePlaybookSchema = z.object({ playbookId: z.string().uuid(), enabled: boolFromForm });
export const runIdSchema = z.object({ runId: z.string().uuid() });
export const notificationIdSchema = z.object({ notificationId: z.string().uuid() });
export const webhookSchema = z.object({
  url: z.string().url("Must be a valid URL").max(500),
  secret: z.string().trim().max(200).default(""),
});
export const webhookIdSchema = z.object({ webhookId: z.string().uuid() });
export const webhookToggleSchema = z.object({ webhookId: z.string().uuid(), enabled: boolFromForm });
