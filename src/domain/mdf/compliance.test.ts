import { describe, it, expect } from "vitest";
import {
  coFunding,
  derivedDeadlines,
  complianceChecks,
  isBlocked,
  planSummary,
  type PlanItemLike,
} from "@/domain/mdf/compliance";

const TODAY = "2026-06-23";

function item(over: Partial<PlanItemLike>): PlanItemLike {
  return {
    catalogKey: "industry-conference", // approved/event
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    totalCost: 20_000,
    coFundPct: 50,
    brandingConfirmed: true,
    ...over,
  };
}

const severities = (checks: ReturnType<typeof complianceChecks>) =>
  Object.fromEntries(checks.map((c) => [c.key, c.severity]));

describe("coFunding", () => {
  it("splits total cost into AWS ask + partner share (default 50%)", () => {
    expect(coFunding(20_000)).toEqual({ totalCost: 20_000, amountToClaim: 10_000, partnerShare: 10_000 });
    expect(coFunding(15_000, 50).amountToClaim).toBe(7_500);
    expect(coFunding(20_000, 100)).toMatchObject({ amountToClaim: 20_000, partnerShare: 0 });
    expect(coFunding(0).amountToClaim).toBe(0);
  });
  it("rounds the ask and clamps the percent", () => {
    expect(coFunding(10_001, 50).amountToClaim).toBe(5_001); // round half up
    expect(coFunding(100, 250).amountToClaim).toBe(100); // pct clamped to 100
  });
});

describe("derivedDeadlines", () => {
  it("submitBy = 14 days before start, capped at Dec 1; claimBy = 30 days after end, capped at Dec 15", () => {
    expect(derivedDeadlines("2026-08-01", "2026-08-03")).toEqual({ submitBy: "2026-07-18", claimBy: "2026-09-02" });
  });
  it("caps late-year activities at the Dec 1 / Dec 15 ceilings", () => {
    expect(derivedDeadlines("2026-12-20", "2026-12-22")).toEqual({ submitBy: "2026-12-01", claimBy: "2026-12-15" });
  });
  it("is null when dates are missing", () => {
    expect(derivedDeadlines(null, null)).toEqual({ submitBy: null, claimBy: null });
  });
});

describe("complianceChecks", () => {
  it("a clean approved item passes every rule (no block, no warn)", () => {
    const checks = complianceChecks(item({}), TODAY);
    expect(checks.some((c) => c.severity === "block")).toBe(false);
    expect(checks.some((c) => c.severity === "warn")).toBe(false);
    expect(severities(checks).eligibility).toBe("ok");
  });

  it("blocks an ineligible activity type", () => {
    const checks = complianceChecks(item({ catalogKey: "travel" }), TODAY);
    expect(severities(checks).eligibility).toBe("block");
    expect(isBlocked(item({ catalogKey: "travel" }), TODAY)).toBe(true);
  });

  it("blocks dates that cross calendar years", () => {
    const checks = complianceChecks(item({ startDate: "2026-12-20", endDate: "2027-01-05" }), TODAY);
    expect(severities(checks).calendar_year).toBe("block");
  });

  it("blocks an activity that has already started (pre-approval required)", () => {
    const checks = complianceChecks(item({ startDate: "2026-06-01", endDate: "2026-06-10" }), TODAY);
    expect(severities(checks).pre_approval).toBe("block");
  });

  it("blocks past the Dec 1 submission cutoff", () => {
    const checks = complianceChecks(item({ startDate: "2026-12-20", endDate: "2026-12-22" }), "2026-12-05");
    expect(severities(checks).submit_cutoff).toBe("block");
  });

  it("warns on short lead time, missing branding, and over-budget ask", () => {
    const checks = complianceChecks(
      item({ startDate: "2026-06-30", endDate: "2026-07-01", brandingConfirmed: false }),
      TODAY,
      5_000, // ask is 10k > 5k available
    );
    const s = severities(checks);
    expect(s.lead_time).toBe("warn");
    expect(s.branding).toBe("warn");
    expect(s.budget).toBe("warn");
    expect(isBlocked(item({ startDate: "2026-06-30", endDate: "2026-07-01" }), TODAY)).toBe(false);
  });

  it("warns when no activity type is selected", () => {
    expect(severities(complianceChecks(item({ catalogKey: null }), TODAY)).eligibility).toBe("warn");
  });
});

describe("planSummary", () => {
  const items = [
    item({}), // ask 10000, clean
    item({ catalogKey: "travel", totalCost: 8_000 }), // blocked
    item({ startDate: "2026-06-30", endDate: "2026-07-01", totalCost: 4_000 }), // ask 2000, lead-time warn
  ];

  it("sums eligible ask (excluding blocked items) against available MDF", () => {
    const s = planSummary(items, 15_000, TODAY);
    expect(s.totalCost).toBe(32_000);
    expect(s.eligibleAsk).toBe(12_000); // 10k + 2k; travel excluded
    expect(s.blockedCount).toBe(1);
    expect(s.warnCount).toBe(1);
    expect(s.headroom).toBe(3_000);
    expect(s.over).toBe(false);
  });

  it("flags over-budget when eligible ask exceeds available MDF", () => {
    const s = planSummary(items, 8_000, TODAY);
    expect(s.over).toBe(true);
    expect(s.headroom).toBe(-4_000);
  });
});
