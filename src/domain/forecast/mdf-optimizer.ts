import type { ActivitySummary } from "@/domain/mdf/analytics";

/**
 * Pure MDF budget optimizer: split the active budget's REMAINING dollars across
 * activity types in proportion to their observed pipeline-per-dollar (the per-activity
 * ROI from summaryByActivity), and report the expected pipeline vs a naive equal split.
 * Deterministic; activities with no approved spend yet are listed as unmeasured (you
 * can't rank what you haven't tried). Expected values are extrapolations of observed
 * ROI — the surface says so.
 */

export interface BudgetAllocation {
  readonly activityType: string;
  /** Observed pipeline-per-dollar for this activity. */
  readonly roi: number;
  /** Share of the remaining budget (0..1, 2dp). */
  readonly share: number;
  /** Recommended dollars (integer; sums exactly to `remaining`). */
  readonly amount: number;
  /** amount x roi. */
  readonly expectedPipeline: number;
}

export interface BudgetPlan {
  readonly remaining: number;
  readonly allocations: readonly BudgetAllocation[];
  /** Activity types with no approved spend yet — unrankable. */
  readonly unmeasured: readonly string[];
  readonly totalExpectedPipeline: number;
  /** Expected pipeline if the same dollars were split equally across ranked activities. */
  readonly equalSplitPipeline: number;
  /** (total - equalSplit) / equalSplit, percent, 1dp; null when equalSplit is 0. */
  readonly upliftPct: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function optimizeBudget(
  activities: readonly ActivitySummary[],
  remaining: number,
): BudgetPlan | null {
  if (remaining <= 0) return null;
  const ranked = activities.filter((a) => a.approved > 0 && a.roi !== null && a.roi > 0);
  if (ranked.length === 0) return null;
  const unmeasured = activities.filter((a) => !(a.approved > 0 && a.roi !== null)).map((a) => a.activityType);

  const totalRoi = ranked.reduce((s, a) => s + (a.roi ?? 0), 0);

  // ROI-proportional shares; integer dollars with the rounding remainder assigned to
  // the top-ranked activity so amounts sum exactly to `remaining`.
  const sorted = [...ranked].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0) || a.activityType.localeCompare(b.activityType));
  let assigned = 0;
  const allocations: BudgetAllocation[] = sorted.map((a, i) => {
    const roi = a.roi ?? 0;
    const share = roi / totalRoi;
    let amount = Math.floor(remaining * share);
    if (i === sorted.length - 1) amount = remaining - assigned; // absorb rounding
    assigned += amount;
    return {
      activityType: a.activityType,
      roi: round2(roi),
      share: round2(share),
      amount,
      expectedPipeline: Math.round(amount * roi),
    };
  });

  const totalExpectedPipeline = allocations.reduce((s, a) => s + a.expectedPipeline, 0);
  const equalAmount = remaining / sorted.length;
  const equalSplitPipeline = Math.round(sorted.reduce((s, a) => s + equalAmount * (a.roi ?? 0), 0));
  const upliftPct =
    equalSplitPipeline > 0
      ? Math.round(((totalExpectedPipeline - equalSplitPipeline) / equalSplitPipeline) * 1000) / 10
      : null;

  return { remaining, allocations, unmeasured, totalExpectedPipeline, equalSplitPipeline, upliftPct };
}
