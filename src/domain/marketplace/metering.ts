/**
 * Pure AWS Marketplace metering rollups. Given submitted usage records and a listing's
 * pricing dimensions, compute acceptance counts and the projected charge (quantity x unit
 * price for accepted records). No DB, no clock -- deterministic and unit-testable.
 */

export type MeteringRecordStatus = "pending" | "accepted" | "rejected";

export interface MeteringRecordLike {
  readonly dimension: string;
  readonly quantity: number;
  readonly status: MeteringRecordStatus;
}

export interface DimensionPriceLike {
  /** Matches the metering record's `dimension` to a price. */
  readonly apiName: string;
  readonly price: number; // integer cents per unit
}

export interface MeteringSummary {
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly pending: number;
  readonly totalQuantity: number;
  /** Sum over ACCEPTED records of quantity x unit price, in integer cents. */
  readonly projectedChargeCents: number;
}

function priceFor(prices: readonly DimensionPriceLike[], dimension: string): number {
  return prices.find((p) => p.apiName === dimension)?.price ?? 0;
}

export function meteringSummary(
  records: readonly MeteringRecordLike[],
  prices: readonly DimensionPriceLike[],
): MeteringSummary {
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  let totalQuantity = 0;
  let projectedChargeCents = 0;
  for (const r of records) {
    totalQuantity += r.quantity;
    if (r.status === "accepted") {
      accepted += 1;
      projectedChargeCents += r.quantity * priceFor(prices, r.dimension);
    } else if (r.status === "rejected") {
      rejected += 1;
    } else {
      pending += 1;
    }
  }
  return { total: records.length, accepted, rejected, pending, totalQuantity, projectedChargeCents };
}

export interface DimensionUsage {
  readonly dimension: string;
  readonly quantity: number;
  readonly records: number;
  readonly chargeCents: number;
}

/** Usage grouped by dimension (accepted records only contribute to the charge), sorted by quantity desc. */
export function usageByDimension(
  records: readonly MeteringRecordLike[],
  prices: readonly DimensionPriceLike[],
): DimensionUsage[] {
  const byDim = new Map<string, { quantity: number; records: number; chargeCents: number }>();
  for (const r of records) {
    const cur = byDim.get(r.dimension) ?? { quantity: 0, records: 0, chargeCents: 0 };
    cur.quantity += r.quantity;
    cur.records += 1;
    if (r.status === "accepted") cur.chargeCents += r.quantity * priceFor(prices, r.dimension);
    byDim.set(r.dimension, cur);
  }
  return [...byDim.entries()]
    .map(([dimension, v]) => ({ dimension, ...v }))
    .sort((a, b) => b.quantity - a.quantity);
}

/**
 * Split items into runs of `size` — AWS BatchMeterUsage accepts at most 25
 * usage records per call, so bulk resubmission batches through this.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
