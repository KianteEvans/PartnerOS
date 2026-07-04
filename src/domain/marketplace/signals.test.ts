import { describe, it, expect } from "vitest";
import { marketplaceDecisions } from "@/domain/marketplace/signals";
import type { CommandMarketplaceListing } from "@/domain/command/types";

const listing = (over: Partial<CommandMarketplaceListing> & { id: string; title: string }): CommandMarketplaceListing => ({
  published: false,
  expiringEntitlements: 0,
  expiredEntitlements: 0,
  failedChangeSets: 0,
  acceptedUsageCount: 0,
  attributedRevenueCents: 0,
  ...over,
});

describe("marketplaceDecisions", () => {
  it("emits an expired-entitlement signal (high) and prefers it over expiring", () => {
    const d = marketplaceDecisions([
      listing({ id: "L1", title: "Acme", expiredEntitlements: 1, expiringEntitlements: 2 }),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]!.id).toBe("mp-ent-expired-L1");
    expect(d[0]!.severity).toBe("high");
    expect(d[0]!.situation).toBe("marketplace_entitlement");
  });

  it("emits an expiring-entitlement signal (medium) when none are expired", () => {
    const d = marketplaceDecisions([listing({ id: "L2", title: "Beta", expiringEntitlements: 3 })]);
    expect(d[0]!.id).toBe("mp-ent-expiring-L2");
    expect(d[0]!.severity).toBe("medium");
  });

  it("flags a failed change set with a link to the listing", () => {
    const d = marketplaceDecisions([listing({ id: "L3", title: "Gamma", failedChangeSets: 2 })]);
    const cs = d.find((x) => x.id === "mp-cs-L3")!;
    expect(cs.situation).toBe("marketplace_changeset");
    expect(cs.link).toBe("/marketplace/L3");
  });

  it("flags metering + attribution gaps only for published listings", () => {
    const published = marketplaceDecisions([
      listing({ id: "P", title: "Pub", published: true, acceptedUsageCount: 0, attributedRevenueCents: 0 }),
    ]);
    expect(published.some((x) => x.id === "mp-meter-P")).toBe(true);
    expect(published.some((x) => x.id === "mp-attr-P")).toBe(true);
    expect(published.every((x) => x.situation === "marketplace_revenue_gap")).toBe(true);

    const draft = marketplaceDecisions([
      listing({ id: "D", title: "Draft", published: false, acceptedUsageCount: 0, attributedRevenueCents: 0 }),
    ]);
    expect(draft).toHaveLength(0);
  });

  it("stays quiet for a healthy published listing", () => {
    const d = marketplaceDecisions([
      listing({ id: "OK", title: "Healthy", published: true, acceptedUsageCount: 9, attributedRevenueCents: 5000 }),
    ]);
    expect(d).toHaveLength(0);
  });
});
