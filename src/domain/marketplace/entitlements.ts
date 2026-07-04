/**
 * Pure AWS Marketplace entitlement logic: per-entitlement status from its expiration date,
 * a portfolio rollup, and coverage of entitled value vs metered usage (overage). No DB, no
 * clock -- the caller passes `today` (YYYY-MM-DD). Deterministic and unit-testable.
 */

export type EntitlementStatus = "active" | "expiring" | "expired";

/** Days before expiry at which an entitlement is flagged "expiring". */
export const EXPIRING_WINDOW_DAYS = 30;

export interface EntitlementLike {
  readonly dimension: string;
  readonly value: number;
  /** ISO date (YYYY-MM-DD) or null for a perpetual/contract entitlement. */
  readonly expirationDate: string | null;
}

function addDays(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function entitlementStatus(expirationDate: string | null, today: string): EntitlementStatus {
  if (!expirationDate) return "active"; // perpetual / no expiry
  if (expirationDate < today) return "expired";
  if (expirationDate <= addDays(today, EXPIRING_WINDOW_DAYS)) return "expiring";
  return "active";
}

export interface EntitlementSummary {
  readonly total: number;
  readonly active: number;
  readonly expiring: number;
  readonly expired: number;
  readonly totalValue: number;
}

export function entitlementSummary(
  items: readonly EntitlementLike[],
  today: string,
): EntitlementSummary {
  let active = 0;
  let expiring = 0;
  let expired = 0;
  let totalValue = 0;
  for (const e of items) {
    totalValue += e.value;
    const s = entitlementStatus(e.expirationDate, today);
    if (s === "active") active += 1;
    else if (s === "expiring") expiring += 1;
    else expired += 1;
  }
  return { total: items.length, active, expiring, expired, totalValue };
}

export interface DimensionCoverage {
  readonly dimension: string;
  readonly entitled: number;
  readonly metered: number;
  /** metered > entitled: the customer is consuming beyond what they bought. */
  readonly overage: boolean;
}

/**
 * Per-dimension coverage of entitled value (sum of active entitlements) vs metered quantity.
 * Surfaces over-consumption so the partner can follow up. Only active entitlements count.
 */
export function coverageByDimension(
  entitlements: readonly EntitlementLike[],
  metered: ReadonlyMap<string, number>,
  today: string,
): DimensionCoverage[] {
  const entitledByDim = new Map<string, number>();
  for (const e of entitlements) {
    if (entitlementStatus(e.expirationDate, today) === "expired") continue;
    entitledByDim.set(e.dimension, (entitledByDim.get(e.dimension) ?? 0) + e.value);
  }
  const dims = new Set<string>([...entitledByDim.keys(), ...metered.keys()]);
  return [...dims]
    .map((dimension) => {
      const entitled = entitledByDim.get(dimension) ?? 0;
      const m = metered.get(dimension) ?? 0;
      return { dimension, entitled, metered: m, overage: m > entitled };
    })
    .sort((a, b) => b.metered - a.metered);
}
