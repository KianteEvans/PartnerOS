/**
 * Pure shaping of marketplace daily snapshots into per-metric sparkline series. No DB, no
 * clock -- the loader reads the rows, this turns them into chronological number arrays the
 * MetricCard `trend` prop consumes. Deterministic and unit-testable.
 */

export interface MarketplaceSnapshotRow {
  readonly capturedOn: string; // YYYY-MM-DD
  readonly attributedRevenueCents: number;
  readonly listings: number;
  readonly published: number;
  readonly activeEntitlements: number;
  readonly meteredUsageCents: number;
  readonly mrrCents: number;
}

export interface MarketplaceTrends {
  readonly revenue: number[];
  readonly listings: number[];
  readonly published: number[];
  readonly activeEntitlements: number[];
  readonly meteredUsage: number[];
  readonly mrr: number[];
}

/** Snapshot rows (any order) -> each metric as a chronological (oldest-first) series. */
export function marketplaceTrendSeries(rows: readonly MarketplaceSnapshotRow[]): MarketplaceTrends {
  const chron = [...rows].sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  return {
    revenue: chron.map((r) => r.attributedRevenueCents),
    listings: chron.map((r) => r.listings),
    published: chron.map((r) => r.published),
    activeEntitlements: chron.map((r) => r.activeEntitlements),
    meteredUsage: chron.map((r) => r.meteredUsageCents),
    mrr: chron.map((r) => r.mrrCents),
  };
}
