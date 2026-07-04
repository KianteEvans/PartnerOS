import { describe, it, expect } from "vitest";
import {
  entitlementStatus,
  entitlementSummary,
  coverageByDimension,
} from "@/domain/marketplace/entitlements";

const today = "2026-06-30";

describe("entitlementStatus", () => {
  it("is active for no expiry or a far-future expiry", () => {
    expect(entitlementStatus(null, today)).toBe("active");
    expect(entitlementStatus("2026-12-31", today)).toBe("active");
  });
  it("is expiring within 30 days and expired in the past", () => {
    expect(entitlementStatus("2026-07-15", today)).toBe("expiring");
    expect(entitlementStatus("2026-06-30", today)).toBe("expiring"); // today = boundary
    expect(entitlementStatus("2026-06-29", today)).toBe("expired");
  });
});

describe("entitlementSummary", () => {
  it("counts by status and sums value", () => {
    expect(
      entitlementSummary(
        [
          { dimension: "users", value: 10, expirationDate: null },
          { dimension: "users", value: 5, expirationDate: "2026-07-10" },
          { dimension: "hosts", value: 2, expirationDate: "2026-01-01" },
        ],
        today,
      ),
    ).toEqual({ total: 3, active: 1, expiring: 1, expired: 1, totalValue: 17 });
  });
});

describe("coverageByDimension", () => {
  it("flags overage when metered exceeds active entitled value", () => {
    const cov = coverageByDimension(
      [
        { dimension: "users", value: 10, expirationDate: null },
        { dimension: "hosts", value: 5, expirationDate: "2026-01-01" }, // expired -> excluded
      ],
      new Map([
        ["users", 14],
        ["hosts", 3],
      ]),
      today,
    );
    const byDim = Object.fromEntries(cov.map((c) => [c.dimension, c]));
    expect(byDim["users"]).toEqual({ dimension: "users", entitled: 10, metered: 14, overage: true });
    expect(byDim["hosts"]).toEqual({ dimension: "hosts", entitled: 0, metered: 3, overage: true });
  });
});
