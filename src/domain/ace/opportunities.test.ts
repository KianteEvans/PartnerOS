import { describe, it, expect } from "vitest";
import {
  isStale,
  isHighValue,
  isAtRisk,
  hygieneIssues,
  priorityScore,
  filterOpportunities,
  viewCounts,
  pipelineSummary,
  repWorkload,
  stageFunnel,
  winRate,
  type OppLike,
} from "@/domain/ace/opportunities";

const TODAY = "2026-06-23";

function opp(over: Partial<OppLike>): OppLike {
  return {
    status: "open",
    stage: "qualified",
    amount: 50_000,
    source: "partner_originated",
    ownerUserId: "u1",
    nextStep: "Schedule demo",
    lastInteraction: "2026-06-20",
    closeDate: "2026-09-01",
    routingStatus: "routed",
    ...over,
  };
}

describe("ace opportunity diagnostics", () => {
  it("flags stale, high-value, and at-risk", () => {
    expect(isStale(opp({ lastInteraction: "2026-01-01" }), TODAY)).toBe(true);
    expect(isStale(opp({ lastInteraction: null }), TODAY)).toBe(true);
    expect(isStale(opp({ lastInteraction: "2026-06-20" }), TODAY)).toBe(false);
    expect(isStale(opp({ status: "won", lastInteraction: null }), TODAY)).toBe(false);
    expect(isHighValue(opp({ amount: 150_000 }))).toBe(true);
    expect(isAtRisk(opp({ closeDate: "2026-01-01" }), TODAY)).toBe(true); // past close
  });

  it("lists hygiene issues only for open opps", () => {
    expect(hygieneIssues(opp({ ownerUserId: null, nextStep: "", closeDate: null, lastInteraction: "2026-01-01" }), TODAY)).toEqual([
      "No internal owner",
      "No next step",
      "No close date",
      "Stale interaction",
    ]);
    expect(hygieneIssues(opp({ status: "won" }), TODAY)).toEqual([]);
  });

  it("priorityScore rewards value, stage, and risk; closed scores 0", () => {
    const a = priorityScore(opp({ amount: 200_000, stage: "launched", closeDate: "2026-01-01" }), TODAY);
    const b = priorityScore(opp({ amount: 10_000, stage: "prospect", closeDate: "2026-12-01", lastInteraction: "2026-06-20" }), TODAY);
    expect(a).toBeGreaterThan(b);
    expect(priorityScore(opp({ status: "lost" }), TODAY)).toBe(0);
  });

  it("filters and counts views", () => {
    const list = [
      opp({ amount: 150_000, source: "amazon_originated" }),
      opp({ status: "won", amount: 80_000 }),
      opp({ routingStatus: "unrouted", ownerUserId: null }),
      opp({ lastInteraction: "2026-01-01" }), // stale -> at risk
    ];
    expect(filterOpportunities(list, "high_value", { today: TODAY })).toHaveLength(1);
    expect(filterOpportunities(list, "won", { today: TODAY })).toHaveLength(1);
    expect(filterOpportunities(list, "unrouted", { today: TODAY })).toHaveLength(1);
    const counts = viewCounts(list, { today: TODAY });
    expect(counts.all).toBe(3); // open ones
    expect(counts.amazon).toBe(1);
    expect(counts.at_risk).toBe(1);
  });

  it("summarizes the pipeline and rep workload", () => {
    const list = [
      opp({ amount: 100_000, ownerUserId: "u1" }),
      opp({ amount: 40_000, ownerUserId: "u1" }),
      opp({ status: "won", amount: 60_000, ownerUserId: "u2" }),
      opp({ routingStatus: "unrouted", ownerUserId: null, amount: 10_000 }),
    ];
    const s = pipelineSummary(list, TODAY);
    expect(s.open).toBe(3);
    expect(s.openValue).toBe(150_000);
    expect(s.won).toBe(1);
    expect(s.wonValue).toBe(60_000);
    expect(s.unrouted).toBe(1);

    const load = repWorkload(list);
    expect(load[0]).toEqual({ ownerUserId: "u1", openCount: 2, openValue: 140_000 });
  });

  it("builds a 6-stage funnel (count + value per stage, closed_lost excluded)", () => {
    const list = [
      opp({ stage: "qualified", amount: 30_000 }),
      opp({ stage: "qualified", amount: 20_000 }),
      opp({ stage: "committed", amount: 100_000 }),
      opp({ status: "won", stage: "launched", amount: 80_000 }),
      opp({ status: "lost", stage: "closed_lost", amount: 5_000 }), // excluded from funnel
    ];
    const f = stageFunnel(list);
    expect(f.map((s) => s.stage)).toEqual([
      "prospect",
      "qualified",
      "tech_validation",
      "business_validation",
      "committed",
      "launched",
    ]);
    expect(f.find((s) => s.stage === "qualified")).toMatchObject({ count: 2, value: 50_000 });
    expect(f.find((s) => s.stage === "committed")).toMatchObject({ count: 1, value: 100_000 });
    expect(f.find((s) => s.stage === "launched")).toMatchObject({ count: 1, value: 80_000 });
    expect(f.find((s) => s.stage === "prospect")).toMatchObject({ count: 0, value: 0 });
  });

  it("computes win rate over closed opps; null when nothing closed", () => {
    expect(winRate([opp({ status: "won" }), opp({ status: "won" }), opp({ status: "lost" })])).toBe(67);
    expect(winRate([opp({ status: "open" })])).toBeNull();
  });
});
