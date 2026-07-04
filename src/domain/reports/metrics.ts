import { portfolioSummary, type MdfLike } from "@/domain/mdf/analytics";
import { pipelineSummary, type OppLike } from "@/domain/ace/opportunities";
import { completeness, type EvidenceLike } from "@/domain/evidence/inventory";
import { planSummary, type RequirementValue } from "@/domain/tiers/gap";
import { money } from "@/domain/format";

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
  /** AWS Marketplace rollup (optional — older callers/snapshots predate it). */
  readonly marketplace?:
    | {
        readonly listings: number;
        readonly published: number;
        readonly activeEntitlements: number;
        readonly attributedRevenueCents: number;
      }
    | undefined;
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
  /** AWS Marketplace section (optional — absent on snapshots generated before it shipped). */
  readonly marketplace?: {
    readonly listings: number;
    readonly published: number;
    readonly activeEntitlements: number;
    readonly attributedRevenueCents: number;
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

  const marketplace = inputs.marketplace ?? {
    listings: 0,
    published: 0,
    activeEntitlements: 0,
    attributedRevenueCents: 0,
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
    marketplace,
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
    { label: "Marketplace listings present", ok: (s.marketplace?.listings ?? 0) > 0 },
  ];
  return { checks, ready: checks.some((c) => c.ok) };
}

/** A short generated narrative for the report header. */
export function narrativeSummary(s: ReportSnapshot, type: ReportType): string {
  const parts = [
    `${REPORT_TYPE_LABELS[type]}.`,
    `MDF: ${money(s.mdf.approved)} approved of ${money(s.mdf.requested)} requested (ROI ${s.mdf.roi ?? "—"}x).`,
    `ACE: ${s.ace.open} open opportunities worth ${money(s.ace.openValue)}, ${s.ace.atRisk} at risk.`,
    `Evidence ${s.evidence.percent}% approved.`,
    `${s.programs.active} active programs, ${s.programs.pending} in progress.`,
    // ASCII arrow: this string is STORED (reports.summary) and the Windows dev/test
    // embedded Postgres is WIN1252, which cannot encode U+2192.
    s.tier ? `Tier ${s.tier.current} -> ${s.tier.target} at ${s.tier.percent}%.` : "",
    `${s.tasks.open} open tasks (${s.tasks.overdue} overdue).`,
    s.marketplace && s.marketplace.listings > 0
      ? `Marketplace: ${s.marketplace.published} published of ${s.marketplace.listings} listings, ${money(Math.round(s.marketplace.attributedRevenueCents / 100))} attributed.`
      : "",
  ];
  return parts.filter((p) => p.length > 0).join(" ");
}

export type ReportHealthBand = "strong" | "fair" | "at_risk";

export interface ReportHealthDriver {
  readonly label: string;
  readonly score: number;
}

export interface ReportHealth {
  readonly score: number;
  readonly band: ReportHealthBand;
  readonly drivers: readonly ReportHealthDriver[];
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Partnership-health composite derived from a report's OWN frozen snapshot numbers
 * (so it stays correct for a point-in-time report). Each present section contributes a
 * 0–100 driver; the score is the average of present drivers. Bands mirror the Command
 * Center health bands. Works for every existing report — no snapshot change.
 */
export function healthFromSnapshot(s: ReportSnapshot): ReportHealth {
  const drivers: ReportHealthDriver[] = [];
  if (s.evidence.total > 0) drivers.push({ label: "Evidence", score: clampPct(s.evidence.percent) });
  if (s.programs.total > 0) drivers.push({ label: "Programs", score: clampPct((s.programs.active / s.programs.total) * 100) });
  if (s.tier) drivers.push({ label: "Tier", score: clampPct(s.tier.percent) });
  if (s.tasks.total > 0) drivers.push({ label: "Tasks", score: s.tasks.open > 0 ? clampPct((1 - s.tasks.overdue / s.tasks.open) * 100) : 100 });
  if (s.ace.open > 0) drivers.push({ label: "ACE", score: clampPct((1 - s.ace.atRisk / s.ace.open) * 100) });
  if (s.mdf.requested > 0) drivers.push({ label: "MDF", score: clampPct((s.mdf.approved / s.mdf.requested) * 100) });
  if (s.marketplace && s.marketplace.listings > 0) drivers.push({ label: "Marketplace", score: clampPct((s.marketplace.published / s.marketplace.listings) * 100) });

  const score = drivers.length > 0 ? Math.round(drivers.reduce((sum, d) => sum + d.score, 0) / drivers.length) : 0;
  const band: ReportHealthBand = score >= 70 ? "strong" : score >= 45 ? "fair" : "at_risk";
  return { score, band, drivers };
}

export interface KpiDelta {
  readonly label: string;
  readonly current: number;
  readonly prior: number | null;
  readonly delta: number | null;
  /** When true a NEGATIVE delta is good (e.g. fewer overdue tasks). */
  readonly invert: boolean;
}

/** Period-over-period change of the headline KPIs vs the previously generated report. */
export function snapshotDelta(cur: ReportSnapshot, prior: ReportSnapshot | null): KpiDelta[] {
  const pick = (label: string, get: (s: ReportSnapshot) => number, invert = false): KpiDelta => {
    const current = get(cur);
    const p = prior ? get(prior) : null;
    return { label, current, prior: p, delta: p === null ? null : current - p, invert };
  };
  return [
    pick("MDF approved", (s) => s.mdf.approved),
    pick("ACE open pipeline", (s) => s.ace.openValue),
    pick("ACE won", (s) => s.ace.wonValue),
    pick("Evidence %", (s) => s.evidence.percent),
    pick("Active programs", (s) => s.programs.active),
    pick("Tier %", (s) => (s.tier ? s.tier.percent : 0)),
    pick("Overdue tasks", (s) => s.tasks.overdue, true),
    pick("Marketplace revenue", (s) => s.marketplace?.attributedRevenueCents ?? 0),
  ];
}
