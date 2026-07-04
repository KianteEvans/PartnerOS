import type { DriverWeightKey } from "@/domain/command/health";
import type { Decision, Severity, Situation } from "@/domain/command/brief";
import type { GraphTone } from "@/domain/graph/types";

/**
 * Pure, dependency-light helpers shared by the causal + attribution graph builders.
 * They restate the SAME thresholds/links the Command Center already uses (band colors,
 * driver colors, driver deep-links) so the graph is consistent-by-construction with the
 * Workbench — no new judgement, just a different projection of the same model.
 */

/** The six health-score drivers, in the fixed order healthScore emits them. */
export type DriverLabel = "Evidence" | "MDF" | "ACE" | "Programs" | "Tasks" | "Tier";

/** Band → tone (mirrors BAND_COLOR in command/page.tsx). */
export function bandTone(band: string): GraphTone {
  return band === "strong" ? "ok" : band === "fair" ? "warn" : "danger";
}

/** Driver score → tone (mirrors driverColor in command/page.tsx: ≥70 ok, ≥45 warn, else danger). */
export function driverTone(score: number): GraphTone {
  return score >= 70 ? "ok" : score >= 45 ? "warn" : "danger";
}

/** Decision severity → tone (mirrors SEVERITY_COLOR in command/page.tsx). */
export function severityTone(sev: Severity): GraphTone {
  return sev === "critical" ? "danger" : sev === "high" ? "warn" : "neutral";
}

/** Driver label → the WEIGHTS key (labels are Title-case, weight keys are lowercase). */
export const DRIVER_WEIGHT_KEY: Record<DriverLabel, DriverWeightKey> = {
  Evidence: "evidence",
  MDF: "mdf",
  ACE: "ace",
  Programs: "programs",
  Tasks: "tasks",
  Tier: "tier",
};

/** Where each driver drills through to (mirrors DRIVER_LINK in command/page.tsx). */
export const DRIVER_LINK: Record<DriverLabel, string> = {
  Evidence: "/programs/evidence",
  Programs: "/programs",
  Tier: "/programs/tiers",
  Tasks: "/command/tasks",
  ACE: "/ace",
  MDF: "/mdf",
};

/**
 * Which of the six health drivers a decision's situation belongs to — or `null` for
 * situations that are NOT health-score inputs (marketplace + AWS-sync), which are
 * therefore omitted from the causal (health-decomposition) map. This is a grouping
 * of the open risks per domain; the honest per-cause health effect comes from impact.ts.
 */
export const SITUATION_TO_DRIVER: Record<Situation, DriverLabel | null> = {
  overdue_work: "Tasks",
  blocked_work: "Tasks",
  mdf_deadline: "MDF",
  plan_submission_due: "MDF",
  aws_review: "ACE",
  roadmap_risk: "Programs",
  renewal_due: "Programs",
  evidence: "Evidence",
  marketplace_entitlement: null,
  marketplace_changeset: null,
  marketplace_revenue_gap: null,
  aws_sync_stale: null,
  aws_sync_drift: null,
  funding_deadline: null,
  funding_rematch: null,
  evidence_expired: "Evidence",
  stalled_deal: "ACE",
};

/**
 * Recover the next-best-action candidate `key` from a Decision, so a cause node can be
 * matched to its impact projection. Returns `null` when the decision has no what-if
 * transform (plan events, cooling reps, program renewals, upcoming milestones, solution
 * renewals) — those nodes still render, just without an impact badge.
 *
 * Decision ids: `task-overdue-{id}` / `task-blocked-{id}` → `task-{id}`; `opp-{id}`,
 * `mdf-{id}`, `evidence-{id}`, `milestone-{id}` pass through; `milestone-upcoming-{id}`,
 * `planev-{id}`, `rep-{id}`, `program-{id}`, `solution-renewal-{id}` have no candidate.
 */
export function decisionToActionKey(d: Decision): string | null {
  switch (d.situation) {
    case "overdue_work":
    case "blocked_work":
      return `task-${d.id.replace(/^task-(overdue|blocked)-/, "")}`;
    case "mdf_deadline":
      return d.id; // mdf-{id}
    case "aws_review":
    case "stalled_deal":
      return d.id.startsWith("opp-") ? d.id : null; // rep-* has no candidate
    case "roadmap_risk":
      // Only overdue milestones are candidates — not upcoming milestones or programs.
      return d.id.startsWith("milestone-") && !d.id.startsWith("milestone-upcoming-") ? d.id : null;
    case "evidence":
      return d.id; // evidence-{id}
    default:
      return null; // plan_submission_due, renewal_due, marketplace_*, aws_sync_*
  }
}
