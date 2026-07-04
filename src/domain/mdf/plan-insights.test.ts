import { describe, it, expect } from "vitest";
import { itemRoi, recommendedFit, planTimelineLayout, type FitItem } from "@/domain/mdf/plan-insights";
import { planSummary, type PlanItemLike } from "@/domain/mdf/compliance";

const TODAY = "2026-06-23";

function fit(over: Partial<FitItem> & { id: string }): FitItem {
  return {
    catalogKey: "industry-conference", // approved/event
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    totalCost: 10_000,
    coFundPct: 50,
    expectedPipeline: 0,
    ...over,
  };
}

describe("itemRoi", () => {
  it("is projected pipeline per AWS-ask dollar", () => {
    expect(itemRoi({ expectedPipeline: 40_000, totalCost: 20_000, coFundPct: 50 })).toBe(4); // ask 10k
    expect(itemRoi({ expectedPipeline: 5_000, totalCost: 0, coFundPct: 50 })).toBeNull();
  });
});

describe("recommendedFit", () => {
  const a = fit({ id: "a", totalCost: 20_000, expectedPipeline: 80_000 }); // ask 10k, ROI 8
  const b = fit({ id: "b", totalCost: 10_000, expectedPipeline: 15_000 }); // ask 5k, ROI 3
  const c = fit({ id: "c", totalCost: 8_000, expectedPipeline: 40_000 }); // ask 4k, ROI 10
  const blocked = fit({ id: "x", catalogKey: "travel", totalCost: 5_000 }); // ineligible
  const items = [a, b, c, blocked];

  it("greedily fits the highest-ROI events within the budget; defers the rest", () => {
    const r = recommendedFit(items, 12_000, TODAY);
    // ROI order C(10) -> A(8) -> B(3): C(4k) fits, A(10k) overflows, B(5k) fits => 9k spent.
    expect([...r.fitIds].sort()).toEqual(["b", "c"]);
    expect([...r.deferIds]).toEqual(["a"]);
    expect(r.fitIds.has("x")).toBe(false); // blocked excluded entirely
    expect(r.deferIds.has("x")).toBe(false);
  });

  it("fits everything eligible when there's no budget signal", () => {
    const r = recommendedFit(items, 0, TODAY);
    expect([...r.fitIds].sort()).toEqual(["a", "b", "c"]);
    expect(r.deferIds.size).toBe(0);
  });
});

describe("planSummary projected pipeline + ROI", () => {
  it("sums projected pipeline of non-blocked items and derives plan ROI", () => {
    const items: (PlanItemLike & { expectedPipeline: number })[] = [
      { catalogKey: "industry-conference", startDate: "2026-09-01", endDate: "2026-09-03", totalCost: 20_000, coFundPct: 50, expectedPipeline: 80_000 },
      { catalogKey: "travel", startDate: "2026-09-01", endDate: "2026-09-03", totalCost: 8_000, coFundPct: 50, expectedPipeline: 99_000 }, // blocked -> excluded
    ];
    const s = planSummary(items, 50_000, TODAY);
    expect(s.eligibleAsk).toBe(10_000);
    expect(s.projectedPipeline).toBe(80_000);
    expect(s.planRoi).toBe(8);
  });
});

describe("planTimelineLayout", () => {
  it("snaps the window to whole months, includes today, and places bars + markers", () => {
    const layout = planTimelineLayout(
      [
        { id: "a", startDate: "2026-09-01", endDate: "2026-09-03" },
        { id: "b", startDate: "2026-12-15", endDate: "2026-12-20" },
      ],
      TODAY,
    )!;
    expect(layout.windowStart).toBe("2026-06-01"); // today (Jun) pulled into the window, snapped to month start
    expect(layout.windowEnd).toBe("2026-12-31");
    expect(layout.bars).toHaveLength(2);
    expect(layout.todayPct).not.toBeNull();
    expect(layout.ticks).toHaveLength(7); // Jun..Dec
    expect(layout.markers).toHaveLength(1); // the Dec 1 cutoff
    expect(layout.markers[0]!.label).toContain("Dec 1");
  });

  it("returns null when no event has both dates", () => {
    expect(planTimelineLayout([{ id: "a", startDate: null, endDate: null }], TODAY)).toBeNull();
  });
});
