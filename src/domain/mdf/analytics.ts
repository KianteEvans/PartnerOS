import { addDays } from "@/domain/dates";
import { isOpen, type MdfStatus } from "@/domain/mdf/lifecycle";

/**
 * Pure MDF analytics: eligibility preflight, ROI, deadline risk, and portfolio
 * reconciliation. No database, no clock — the caller passes `today`.
 * Deterministic and unit-testable.
 */

/** Default per-request MDF cap used by the eligibility preflight. */
export const REQUEST_AMOUNT_CAP = 50_000;

/** Days before the claim deadline that counts as at-risk. */
export const DEADLINE_WINDOW_DAYS = 30;

export interface MdfLike {
  readonly status: MdfStatus;
  readonly ownerUserId: string | null;
  readonly requestedAmount: number;
  readonly approvedAmount: number | null;
  readonly deployedAmount: number | null;
  readonly claimedAmount: number | null;
  readonly reimbursedAmount: number | null;
  readonly expectedPipeline: number;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly claimDeadline: string | null;
  readonly opportunityRef: string | null;
}

export interface EligibilityCheck {
  readonly key: string;
  readonly label: string;
  readonly ok: boolean;
}

export interface Eligibility {
  readonly checks: readonly EligibilityCheck[];
  readonly eligible: boolean;
}

/** Preflight a request before it can be submitted for approval. */
export function preflight(req: MdfLike): Eligibility {
  const checks: EligibilityCheck[] = [
    { key: "owner", label: "Has an owner", ok: req.ownerUserId !== null },
    { key: "amount", label: "Requested amount is set", ok: req.requestedAmount > 0 },
    {
      key: "cap",
      label: `Within the ${REQUEST_AMOUNT_CAP.toLocaleString()} cap`,
      ok: req.requestedAmount > 0 && req.requestedAmount <= REQUEST_AMOUNT_CAP,
    },
    {
      key: "dates",
      label: "Has activity start and end dates",
      ok: req.startDate !== null && req.endDate !== null && req.startDate <= req.endDate,
    },
    { key: "pipeline", label: "Expected pipeline is set", ok: req.expectedPipeline > 0 },
    {
      key: "attribution",
      label: "ACE / opportunity attribution provided",
      ok: req.opportunityRef !== null && req.opportunityRef.trim().length > 0,
    },
  ];
  return { checks, eligible: checks.every((c) => c.ok) };
}

/** The most-committed amount so far (used as the ROI denominator). */
export function committedAmount(req: MdfLike): number {
  return (
    req.reimbursedAmount ??
    req.claimedAmount ??
    req.deployedAmount ??
    req.approvedAmount ??
    req.requestedAmount
  );
}

/** Expected pipeline divided by committed MDF, e.g. 5 means 5x. Null if no spend. */
export function roiMultiple(req: MdfLike): number | null {
  const spend = committedAmount(req);
  if (spend <= 0) return null;
  return Math.round((req.expectedPipeline / spend) * 100) / 100;
}

/** A claim deadline within the window on a request that hasn't been claimed yet. */
export function deadlineRisk(req: MdfLike, today: string): boolean {
  if (req.claimDeadline === null) return false;
  if (req.status !== "approved" && req.status !== "deployed") return false;
  if (req.claimDeadline < today) return true; // overdue
  return req.claimDeadline <= addDays(today, DEADLINE_WINDOW_DAYS);
}

export interface PortfolioSummary {
  readonly requested: number;
  readonly approved: number;
  readonly deployed: number;
  readonly claimed: number;
  readonly reimbursed: number;
  /** Approved funds not yet claimed. */
  readonly remaining: number;
  readonly pipeline: number;
  /** Portfolio ROI multiple (pipeline / approved), or null if nothing approved. */
  readonly roi: number | null;
  readonly deadlineRisks: number;
  readonly openCount: number;
}

/** Percent of approved funds that have been reimbursed (0 if nothing approved). */
export function reimbursementRate(s: PortfolioSummary): number {
  return s.approved > 0 ? Math.min(100, Math.round((s.reimbursed / s.approved) * 100)) : 0;
}

/** Percent of a request's approved amount that has been claimed (0 if nothing approved). */
export function claimedShare(req: MdfLike): number {
  const approved = req.approvedAmount ?? 0;
  if (approved <= 0) return 0;
  return Math.min(100, Math.round(((req.claimedAmount ?? 0) / approved) * 100));
}

function sum(reqs: readonly MdfLike[], pick: (r: MdfLike) => number | null): number {
  return reqs.reduce((acc, r) => acc + (pick(r) ?? 0), 0);
}

/** Reconciliation across the whole portfolio. */
export function portfolioSummary(
  reqs: readonly MdfLike[],
  today: string,
): PortfolioSummary {
  const requested = sum(reqs, (r) => r.requestedAmount);
  const approved = sum(reqs, (r) => r.approvedAmount);
  const deployed = sum(reqs, (r) => r.deployedAmount);
  const claimed = sum(reqs, (r) => r.claimedAmount);
  const reimbursed = sum(reqs, (r) => r.reimbursedAmount);
  const pipeline = sum(reqs, (r) => r.expectedPipeline);
  return {
    requested,
    approved,
    deployed,
    claimed,
    reimbursed,
    remaining: Math.max(0, approved - claimed),
    pipeline,
    roi: approved > 0 ? Math.round((pipeline / approved) * 100) / 100 : null,
    deadlineRisks: reqs.filter((r) => deadlineRisk(r, today)).length,
    openCount: reqs.filter((r) => isOpen(r.status)).length,
  };
}

export interface ActivitySummary {
  readonly activityType: string;
  readonly count: number;
  readonly requested: number;
  readonly approved: number;
  readonly reimbursed: number;
  readonly pipeline: number;
  /** Pipeline per approved dollar for this activity type, or null if nothing approved. */
  readonly roi: number | null;
}

/**
 * Roll the portfolio up by activity type (event/campaign/content/...), sorted by
 * approved spend. Surfaces which kinds of marketing the MDF is actually funding.
 */
export function summaryByActivity(
  reqs: readonly (MdfLike & { activityType: string })[],
): ActivitySummary[] {
  const groups = new Map<string, (MdfLike & { activityType: string })[]>();
  for (const r of reqs) {
    const g = groups.get(r.activityType);
    if (g) g.push(r);
    else groups.set(r.activityType, [r]);
  }
  return [...groups.entries()]
    .map(([activityType, rows]) => {
      const requested = sum(rows, (r) => r.requestedAmount);
      const approved = sum(rows, (r) => r.approvedAmount);
      const reimbursed = sum(rows, (r) => r.reimbursedAmount);
      const pipeline = sum(rows, (r) => r.expectedPipeline);
      return {
        activityType,
        count: rows.length,
        requested,
        approved,
        reimbursed,
        pipeline,
        roi: approved > 0 ? Math.round((pipeline / approved) * 100) / 100 : null,
      };
    })
    .sort((a, b) => b.approved - a.approved || b.requested - a.requested);
}
