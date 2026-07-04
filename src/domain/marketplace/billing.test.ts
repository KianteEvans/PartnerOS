import { describe, it, expect } from "vitest";
import {
  isActiveAgreement,
  revenueByPeriod,
  billingSummary,
  LISTING_FEE_RATE,
} from "@/domain/marketplace/billing";

const today = "2026-06-30";
const charges = [
  { period: "2026-04", amount: 100_00 },
  { period: "2026-05", amount: 150_00 },
  { period: "2026-05", amount: 50_00 },
  { period: "2026-06", amount: 200_00 },
];

describe("revenueByPeriod", () => {
  it("sums by period chronologically", () => {
    expect(revenueByPeriod(charges)).toEqual([
      { period: "2026-04", amountCents: 100_00 },
      { period: "2026-05", amountCents: 200_00 },
      { period: "2026-06", amountCents: 200_00 },
    ]);
  });
});

describe("isActiveAgreement", () => {
  it("is active when not ended and status is active/renewed/blank", () => {
    expect(isActiveAgreement({ status: "ACTIVE", endDate: "2027-01-01", totalValue: 0 }, today)).toBe(true);
    expect(isActiveAgreement({ status: "", endDate: null, totalValue: 0 }, today)).toBe(true);
    expect(isActiveAgreement({ status: "ACTIVE", endDate: "2026-01-01", totalValue: 0 }, today)).toBe(false);
    expect(isActiveAgreement({ status: "CANCELLED", endDate: null, totalValue: 0 }, today)).toBe(false);
  });
});

describe("billingSummary", () => {
  it("totals revenue, MRR (latest period), ARR, payout, and active agreements", () => {
    const s = billingSummary(
      charges,
      [
        { status: "ACTIVE", endDate: "2027-01-01", totalValue: 500_00 },
        { status: "CANCELLED", endDate: null, totalValue: 0 },
      ],
      today,
    );
    expect(s.totalRevenueCents).toBe(500_00);
    expect(s.mrrCents).toBe(200_00); // June
    expect(s.arrCents).toBe(2400_00);
    expect(s.activeAgreements).toBe(1);
    expect(s.totalAgreements).toBe(2);
    expect(s.payoutCents).toBe(Math.round(500_00 * (1 - LISTING_FEE_RATE)));
  });

  it("is zero for no charges", () => {
    expect(billingSummary([], [], today).mrrCents).toBe(0);
  });
});
