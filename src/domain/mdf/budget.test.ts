import { describe, it, expect } from "vitest";
import { budgetStatus, committedInPeriod, type BudgetReqLike } from "@/domain/mdf/budget";

describe("budgetStatus", () => {
  it("computes remaining + percent under budget", () => {
    expect(budgetStatus(10_000, 6_000)).toEqual({
      allocated: 10_000,
      committed: 6_000,
      remaining: 4_000,
      percent: 60,
      over: false,
    });
  });

  it("flags overspend with a negative remaining", () => {
    const s = budgetStatus(10_000, 12_000);
    expect(s.over).toBe(true);
    expect(s.remaining).toBe(-2_000);
    expect(s.percent).toBe(120);
  });

  it("never divides by zero; any spend over a zero allocation is over", () => {
    expect(budgetStatus(0, 0)).toMatchObject({ percent: 0, over: false });
    expect(budgetStatus(0, 500)).toMatchObject({ percent: 0, over: true, remaining: -500 });
  });
});

describe("committedInPeriod", () => {
  function r(over: Partial<BudgetReqLike>): BudgetReqLike {
    return { status: "approved", approvedAmount: 0, startDate: null, createdAt: "2026-08-15", ...over };
  }
  const START = "2026-07-01";
  const END = "2026-09-30";

  it("sums approved MDF dated within the period, by start date or created fallback", () => {
    const reqs = [
      r({ approvedAmount: 8_000, startDate: "2026-08-01" }), // in, by startDate
      r({ approvedAmount: 9_000, startDate: "2026-10-15" }), // out (after period)
      r({ approvedAmount: 5_000, startDate: null, createdAt: "2026-07-10" }), // in, by createdAt fallback
      r({ approvedAmount: null, startDate: "2026-08-20" }), // in-period but unapproved -> 0
    ];
    expect(committedInPeriod(reqs, START, END)).toBe(13_000);
  });

  it("is zero for an empty portfolio", () => {
    expect(committedInPeriod([], START, END)).toBe(0);
  });
});
