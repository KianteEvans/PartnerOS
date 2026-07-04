import { describe, it, expect } from "vitest";
import { optimizeBudget } from "@/domain/forecast/mdf-optimizer";
import type { ActivitySummary } from "@/domain/mdf/analytics";

function activity(activityType: string, approved: number, pipeline: number): ActivitySummary {
  return {
    activityType,
    count: 1,
    requested: approved,
    approved,
    reimbursed: 0,
    pipeline,
    roi: approved > 0 ? pipeline / approved : null,
  };
}

describe("optimizeBudget", () => {
  it("splits the remaining budget in proportion to observed ROI, summing exactly", () => {
    // event ROI 6x, campaign ROI 2x -> shares 0.75 / 0.25.
    const plan = optimizeBudget([activity("event", 10_000, 60_000), activity("campaign", 10_000, 20_000)], 40_000)!;
    expect(plan.allocations.map((a) => a.activityType)).toEqual(["event", "campaign"]);
    expect(plan.allocations[0]).toMatchObject({ share: 0.75, amount: 30_000, expectedPipeline: 180_000 });
    expect(plan.allocations[1]!.amount).toBe(10_000);
    expect(plan.allocations.reduce((s, a) => s + a.amount, 0)).toBe(40_000);
  });

  it("reports uplift vs an equal split", () => {
    const plan = optimizeBudget([activity("event", 10_000, 60_000), activity("campaign", 10_000, 20_000)], 40_000)!;
    // Optimized: 30k*6 + 10k*2 = 200k. Equal: 20k*6 + 20k*2 = 160k. Uplift 25%.
    expect(plan.totalExpectedPipeline).toBe(200_000);
    expect(plan.equalSplitPipeline).toBe(160_000);
    expect(plan.upliftPct).toBe(25);
  });

  it("a single ranked activity takes 100%; unmeasured types are listed", () => {
    const plan = optimizeBudget([activity("event", 5_000, 25_000), activity("enablement", 0, 0)], 12_000)!;
    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]).toMatchObject({ activityType: "event", share: 1, amount: 12_000 });
    expect(plan.unmeasured).toEqual(["enablement"]);
    expect(plan.upliftPct).toBe(0); // equal split of one == optimized
  });

  it("returns null with no remaining budget or nothing rankable", () => {
    expect(optimizeBudget([activity("event", 10_000, 60_000)], 0)).toBeNull();
    expect(optimizeBudget([activity("enablement", 0, 0)], 10_000)).toBeNull();
  });
});
