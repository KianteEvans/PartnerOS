/**
 * Pure AWS Marketplace billing rollups: revenue from charges, active-agreement counts,
 * current MRR/ARR, and the estimated partner payout after the AWS listing fee. Money is in
 * integer cents. No DB, no clock -- the caller passes `today`. Deterministic + testable.
 */

/** AWS Marketplace listing fee (seller share is 1 - fee). Standard rate ~3%. */
export const LISTING_FEE_RATE = 0.03;

export interface ChargeLike {
  /** Billing period as YYYY-MM. */
  readonly period: string;
  readonly amount: number; // integer cents
}

export interface AgreementLike {
  readonly status: string;
  /** ISO end date (YYYY-MM-DD) or null. */
  readonly endDate: string | null;
  readonly totalValue: number; // integer cents
}

export function isActiveAgreement(a: AgreementLike, today: string): boolean {
  if (a.endDate && a.endDate < today) return false;
  const s = a.status.toLowerCase();
  return s === "" || s === "active" || s === "renewed";
}

export interface RevenuePeriod {
  readonly period: string;
  readonly amountCents: number;
}

/** Charges summed by billing period, chronological. */
export function revenueByPeriod(charges: readonly ChargeLike[]): RevenuePeriod[] {
  const byPeriod = new Map<string, number>();
  for (const c of charges) byPeriod.set(c.period, (byPeriod.get(c.period) ?? 0) + c.amount);
  return [...byPeriod.entries()]
    .map(([period, amountCents]) => ({ period, amountCents }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export interface BillingSummary {
  readonly totalRevenueCents: number;
  readonly activeAgreements: number;
  readonly totalAgreements: number;
  /** Most recent billing period's revenue. */
  readonly mrrCents: number;
  readonly arrCents: number;
  /** Estimated seller payout after the AWS listing fee. */
  readonly payoutCents: number;
}

export function billingSummary(
  charges: readonly ChargeLike[],
  agreements: readonly AgreementLike[],
  today: string,
): BillingSummary {
  const totalRevenueCents = charges.reduce((s, c) => s + c.amount, 0);
  const periods = revenueByPeriod(charges);
  const mrrCents = periods.length > 0 ? periods[periods.length - 1]!.amountCents : 0;
  const activeAgreements = agreements.filter((a) => isActiveAgreement(a, today)).length;
  return {
    totalRevenueCents,
    activeAgreements,
    totalAgreements: agreements.length,
    mrrCents,
    arrCents: mrrCents * 12,
    payoutCents: Math.round(totalRevenueCents * (1 - LISTING_FEE_RATE)),
  };
}
