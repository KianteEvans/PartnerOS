import { addDays } from "@/domain/dates";
import { isOpen, type FundingSubmissionStatus } from "@/domain/funding/lifecycle";

/**
 * Pure funding-portfolio analytics: aggregate a tenant's submissions into the tracker
 * hero metrics, and flag deadline risk. Mirrors the MDF analytics module. No DB — the
 * caller passes rows + `today`.
 */

const DEADLINE_WINDOW_DAYS = 30;

export interface SubmissionLike {
  readonly status: FundingSubmissionStatus;
  readonly fundingType: "cash" | "credits";
  readonly requestedAmount: number;
  readonly approvedAmount: number | null;
  readonly deadline: string | null;
}

/** An open submission whose response deadline is within 30 days or already past. */
export function deadlineRisk(s: SubmissionLike, today: string): boolean {
  if (s.deadline === null || !isOpen(s.status)) return false;
  return s.deadline <= addDays(today, DEADLINE_WINDOW_DAYS);
}

export interface PortfolioSummary {
  readonly total: number;
  readonly open: number;
  readonly approved: number; // approved OR funded
  readonly funded: number;
  readonly rejected: number;
  readonly requested: number; // sum of requestedAmount
  readonly approvedAmount: number; // sum of approvedAmount
  readonly cashCount: number;
  readonly creditsCount: number;
  readonly atDeadline: number;
}

export function portfolioSummary(rows: readonly SubmissionLike[], today: string): PortfolioSummary {
  let open = 0;
  let approved = 0;
  let funded = 0;
  let rejected = 0;
  let requested = 0;
  let approvedAmount = 0;
  let cashCount = 0;
  let creditsCount = 0;
  let atDeadline = 0;
  for (const s of rows) {
    if (isOpen(s.status)) open += 1;
    if (s.status === "approved" || s.status === "funded") approved += 1;
    if (s.status === "funded") funded += 1;
    if (s.status === "rejected") rejected += 1;
    requested += s.requestedAmount;
    approvedAmount += s.approvedAmount ?? 0;
    if (s.fundingType === "cash") cashCount += 1;
    else creditsCount += 1;
    if (deadlineRisk(s, today)) atDeadline += 1;
  }
  return {
    total: rows.length,
    open,
    approved,
    funded,
    rejected,
    requested,
    approvedAmount,
    cashCount,
    creditsCount,
    atDeadline,
  };
}
