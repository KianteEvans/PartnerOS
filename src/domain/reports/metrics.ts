import { portfolioSummary, type MdfLike } from "@/domain/mdf/analytics";
import { pipelineSummary, type OppLike } from "@/domain/ace/opportunities";
import { completeness, type EvidenceLike } from "@/domain/evidence/inventory";
import { planSummary, type RequirementValue } from "@/domain/tiers/gap";

/**
 * Pure reporting metrics: assemble a point-in-time snapshot across every section
 * by REUSING each domain's pure summary function. No database, no clock — the
 * caller passes pre-fetched rows and `today`. Deterministic and unit-testable;
 * the snapshot is JSON-serializable so it can be stored and exported verbatim.
 */

export type ReportType =
  | "executive_plan"
  | "qbr"
  | "mdf_performance"
  | "ace_contribution"
  | "program_readiness"
  | "tier_evidence"
  | "custom";

export type ReportStatus = "draft" | "reviewed" | "approved" | "exported";

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  executive_plan: "Executive Partnership Plan",
  qbr: "AWS QBR",
  mdf_performance: "MDF Performance Report",
  ace_contribution: "ACE Contribution Report",
  program_readiness: "Program-Readiness Report",
  tier_evidence: "Tier & Evidence Report",
  custom: "Custom Leadership Package",
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  exported: "Exported",
};

const TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  draft: ["reviewed"],
  reviewed: ["approved"],
  approved: ["exported"],
  exported: [],
};

export function allowedNext(status: ReportStatus): readonly ReportStatus[] {
  return TRANSITIONS[status];
}

/** A report can be exported once it has been approved. */
export function canExport(status: ReportStatus): boolean {
  return status === "approved" || status === "exported";
}

export interface SnapshotInputs {
  readonly mdf: readonly MdfLike[];
  readonly opportunities: readonly OppLike[];
  readonly evidence: readonly EvidenceLike[];
  readonly programs: readonly { status: string }[];
  readonly tier: {
    readonly currentTier: string;
    readonly targetTier: string;
    readonly status: string;
  } | null;
  readonly tierRequirements: readonly RequirementValue[];
  readonly tasks: readonly { status: string; dueDate: string | null }[];
  readonly assessments: readonly { status: string; overallScore: number | null }[];
}

export interface ReportSnapshot {
  readonly mdf: {
    readonly requested: number;
    readonly approved: number;
    readonly deployed: number;
    readonly claimed: number;
    readonly reimbursed: number;
    readonly remaining: number;
    readonly pipeline: number;
    readonly roi: number | null;
    readonly deadlineRisks: number;
    readonly open: number;
  };
  readonly ace: {
    readonly open: number;
    readonly openValue: number;
    readonly won: number;
    readonly wonValue: number;
    readonly atRisk: number;
    readonly unrouted: number;
  };
  readonly evidence: {
    readonly total: number;
    readonly approved: number;
    readonly missing: number;
    readonly percent: number;
  };
  readonly programs: {
    readonly total: number;
    readonly active: number;
    readonly pending: number;
    readonly expired: number;
  };
  readonly tier: {
    readonly current: string;
    readonly target: string;
    readonly status: string;
    readonly met: number;
    readonly total: number;
    readonly percent: number;
  } | null;
  readonly tasks: {
    readonly total: number;
    readonly open: number;
    readonly done: number;
    readonly overdue: number;
  };
  readonly assessments: {
    readonly count: number;
    readonly scored: number;
    readonly latestScore: number | null;
  };
}

export function buildSnapshot(
  inputs: SnapshotInputs,
  today: string,
): ReportSnapshot {
  const mdf = portfolioSummary(inputs.mdf, today);
  const ace = pipelineSummary(inputs.opportunities, today);
  const ev = completeness(inputs.evidence);
  const tierSummary = planSummary(inputs.tierRequirements);

  const programs = {
    total: inputs.programs.length,
    active: inputs.programs.filter((p) => p.status === "active").length,
    pending: inputs.programs.filter(
      (p) => p.status === "pending" || p.status === "submitted",
    ).length,
    expired: inputs.programs.filter((p) => p.status === "expired").length,
  };

  const overdue = inputs.tasks.filter(
    (t) => t.status !== "done" && t.dueDate !== null && t.dueDate < today,
  ).length;
  const tasks = {
    total: inputs.tasks.length,
    open: inputs.tasks.filter((t) => t.status !== "done").length,
    done: inputs.tasks.filter((t) => t.status === "done").length,
    overdue,
  };

  const scored = inputs.assessments.filter((a) => a.status === "scored");
  const latestScore = scored.reduce<number | null>(
    (best, a) =>
      a.overallScore === null
        ? best
        : best === null
          ? a.overallScore
          : Math.max(best, a.overallScore),
    null,
  );

  return {
    mdf: {
      requested: mdf.requested,
      approved: mdf.approved,
      deployed: mdf.deployed,
      claimed: mdf.claimed,
      reimbursed: mdf.reimbursed,
      remaining: mdf.remaining,
      pipeline: mdf.pipeline,
      roi: mdf.roi,
      deadlineRisks: mdf.deadlineRisks,
      open: mdf.openCount,
    },
    ace: {
      open: ace.open,
      openValue: ace.openValue,
      won: ace.won,
      wonValue: ace.wonValue,
      atRisk: ace.atRisk,
      unrouted: ace.unrouted,
    },
    evidence: { total: ev.total, approved: ev.approved, missing: ev.missing, percent: ev.percent },
    programs,
    tier: inputs.tier
      ? {
          current: inputs.tier.currentTier,
          target: inputs.tier.targetTier,
          status: inputs.tier.status,
          met: tierSummary.met,
          total: tierSummary.total,
          percent: tierSummary.percent,
        }
      : null,
    tasks,
    assessments: {
      count: inputs.assessments.length,
      scored: scored.length,
      latestScore,
    },
  };
}

export interface PreflightCheck {
  readonly label: string;
  readonly ok: boolean;
}

export interface Preflight {
  readonly checks: readonly PreflightCheck[];
  readonly ready: boolean;
}

/** A report needs real data in at least one section before it can be approved. */
export function reportPreflight(s: ReportSnapshot): Preflight {
  const checks: PreflightCheck[] = [
    { label: "MDF activity recorded", ok: s.mdf.requested > 0 },
    { label: "ACE pipeline present", ok: s.ace.open + s.ace.won > 0 },
    { label: "Evidence catalogued", ok: s.evidence.total > 0 },
    { label: "Programs in portfolio", ok: s.programs.total > 0 },
  ];
  return { checks, ready: checks.some((c) => c.ok) };
}

/** A short generated narrative for the report header. */
export function narrativeSummary(s: ReportSnapshot, type: ReportType): string {
  const money = (n: number) => `$${n.toLocaleString()}`;
  const parts = [
    `${REPORT_TYPE_LABELS[type]}.`,
    `MDF: ${money(s.mdf.approved)} approved of ${money(s.mdf.requested)} requested (ROI ${s.mdf.roi ?? "—"}x).`,
    `ACE: ${s.ace.open} open opportunities worth ${money(s.ace.openValue)}, ${s.ace.atRisk} at risk.`,
    `Evidence ${s.evidence.percent}% approved.`,
    `${s.programs.active} active programs, ${s.programs.pending} in progress.`,
    s.tier ? `Tier ${s.tier.current}→${s.tier.target} at ${s.tier.percent}%.` : "",
    `${s.tasks.open} open tasks (${s.tasks.overdue} overdue).`,
  ];
  return parts.filter((p) => p.length > 0).join(" ");
}
