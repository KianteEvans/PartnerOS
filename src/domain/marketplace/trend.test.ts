import { describe, it, expect } from "vitest";
import { marketplaceTrendSeries, type MarketplaceSnapshotRow } from "@/domain/marketplace/trend";

const row = (over: Partial<MarketplaceSnapshotRow> & { capturedOn: string }): MarketplaceSnapshotRow => ({
  attributedRevenueCents: 0,
  listings: 0,
  published: 0,
  activeEntitlements: 0,
  meteredUsageCents: 0,
  mrrCents: 0,
  ...over,
});

describe("marketplaceTrendSeries", () => {
  it("orders rows chronologically and projects each metric to a series", () => {
    const series = marketplaceTrendSeries([
      row({ capturedOn: "2026-06-03", attributedRevenueCents: 300, listings: 3, published: 2, activeEntitlements: 5 }),
      row({ capturedOn: "2026-06-01", attributedRevenueCents: 100, listings: 1, published: 1, activeEntitlements: 2 }),
      row({ capturedOn: "2026-06-02", attributedRevenueCents: 200, listings: 2, published: 1, activeEntitlements: 4 }),
    ]);
    expect(series.revenue).toEqual([100, 200, 300]);
    expect(series.listings).toEqual([1, 2, 3]);
    expect(series.published).toEqual([1, 1, 2]);
    expect(series.activeEntitlements).toEqual([2, 4, 5]);
  });

  it("is empty for no rows", () => {
    expect(marketplaceTrendSeries([])).toEqual({
      revenue: [],
      listings: [],
      published: [],
      activeEntitlements: [],
      meteredUsage: [],
      mrr: [],
    });
  });
});
