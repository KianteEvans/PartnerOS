import { describe, it, expect } from "vitest";
import { meteringSummary, usageByDimension } from "@/domain/marketplace/metering";

const prices = [
  { apiName: "users", price: 500 }, // $5.00
  { apiName: "hosts", price: 200 }, // $2.00
];
const records = [
  { dimension: "users", quantity: 10, status: "accepted" as const }, // 10 * 500 = 5000
  { dimension: "users", quantity: 3, status: "rejected" as const },
  { dimension: "hosts", quantity: 4, status: "accepted" as const }, // 4 * 200 = 800
  { dimension: "hosts", quantity: 2, status: "pending" as const },
];

describe("meteringSummary", () => {
  it("counts by status and projects the accepted charge", () => {
    expect(meteringSummary(records, prices)).toEqual({
      total: 4,
      accepted: 2,
      rejected: 1,
      pending: 1,
      totalQuantity: 19,
      projectedChargeCents: 5800,
    });
  });

  it("charges zero when a dimension has no matching price", () => {
    expect(
      meteringSummary([{ dimension: "ghost", quantity: 100, status: "accepted" }], prices).projectedChargeCents,
    ).toBe(0);
  });

  it("is empty for no records", () => {
    expect(meteringSummary([], prices)).toEqual({
      total: 0,
      accepted: 0,
      rejected: 0,
      pending: 0,
      totalQuantity: 0,
      projectedChargeCents: 0,
    });
  });
});

describe("usageByDimension", () => {
  it("groups by dimension and sorts by quantity (accepted-only charge)", () => {
    expect(usageByDimension(records, prices)).toEqual([
      { dimension: "users", quantity: 13, records: 2, chargeCents: 5000 },
      { dimension: "hosts", quantity: 6, records: 2, chargeCents: 800 },
    ]);
  });
});
