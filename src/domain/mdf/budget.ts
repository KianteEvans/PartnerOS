import type { MdfStatus } from "@/domain/mdf/lifecycle";

/**
 * Pure MDF budget math. A budget is an allocation for a period; "committed" is
 * the approved MDF whose activity falls inside that window. No database, no clock.
 */

export interface BudgetStatus {
  readonly allocated: number;
  readonly committed: number;
  readonly remaining: number;
  /** Committed as a percent of allocated (0 if nothing allocated). */
  readonly percent: number;
  readonly over: boolean;
}

export function budgetStatus(allocated: number, committed: number): BudgetStatus {
  const percent = allocated > 0 ? Math.round((committed / allocated) * 100) : 0;
  return {
    allocated,
    committed,
    remaining: allocated - committed,
    percent,
    over: committed > allocated,
  };
}

/** A request, reduced to what the committed-in-period sum needs. */
export interface BudgetReqLike {
  readonly status: MdfStatus;
  readonly approvedAmount: number | null;
  readonly startDate: string | null;
  /** Created date, YYYY-MM-DD — the fallback when there's no activity start. */
  readonly createdAt: string;
}

/**
 * Approved MDF committed within [periodStart, periodEnd] (inclusive), dated by
 * activity start, falling back to created date. Unapproved requests contribute
 * nothing (approvedAmount is null until approval), so no status filter is needed.
 */
export function committedInPeriod(
  reqs: readonly BudgetReqLike[],
  periodStart: string,
  periodEnd: string,
): number {
  return reqs.reduce((sum, r) => {
    const at = r.startDate ?? r.createdAt;
    if (at < periodStart || at > periodEnd) return sum;
    return sum + (r.approvedAmount ?? 0);
  }, 0);
}
