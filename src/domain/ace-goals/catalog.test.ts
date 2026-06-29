import { describe, it, expect } from "vitest";
import {
  METRIC_CATALOG,
  measureGoal,
  metricByKey,
  isMetricKey,
  formatMetricValue,
  type GoalOpp,
  type GoalData,
} from "@/domain/ace-goals/catalog";

function opp(p: Partial<GoalOpp> = {}): GoalOpp {
  return {
    status: "open",
    stage: "prospect",
    amount: 0,
    source: "partner_originated",
    ownerUserId: null,
    nextStep: "",
    lastInteraction: null,
    closeDate: null,
    routingStatus: "unrouted",
    createdAt: "2026-01-01",
    ...p,
  };
}

const today = "2026-06-29";
const start = "2026-04-01";

function data(opps: GoalOpp[], rels: { createdAt: string }[] = []): GoalData {
  return { opps, rels, today };
}

describe("metric catalog", () => {
  it("exposes the documented metric keys", () => {
    expect(METRIC_CATALOG.map((m) => m.key)).toEqual([
      "total_revenue",
      "net_new_relationships",
      "net_new_aws_originated_opps",
      "closed_won_deals",
      "open_pipeline_value",
      "win_rate",
    ]);
    expect(isMetricKey("total_revenue")).toBe(true);
    expect(isMetricKey("nope")).toBe(false);
  });

  it("total_revenue sums won deals closed on/after the period start, excluding null closeDate", () => {
    const m = metricByKey("total_revenue")!;
    const d = data([
      opp({ status: "won", amount: 50_000, closeDate: "2026-05-01" }), // in window
      opp({ status: "won", amount: 30_000, closeDate: "2026-04-01" }), // boundary (>= start) -> in
      opp({ status: "won", amount: 99_000, closeDate: "2026-03-31" }), // before window -> out
      opp({ status: "won", amount: 12_000, closeDate: null }), // no close date -> out
      opp({ status: "open", amount: 80_000, closeDate: "2026-05-10" }), // not won -> out
    ]);
    expect(m.measure(d, start)).toBe(80_000);
  });

  it("net_new_relationships counts rels created on/after the period start", () => {
    const m = metricByKey("net_new_relationships")!;
    const d = data([], [
      { createdAt: "2026-04-01" }, // boundary -> in
      { createdAt: "2026-06-10" }, // in
      { createdAt: "2026-01-15" }, // before -> out
    ]);
    expect(m.measure(d, start)).toBe(2);
  });

  it("net_new_aws_originated_opps counts amazon-originated opps created in window", () => {
    const m = metricByKey("net_new_aws_originated_opps")!;
    const d = data([
      opp({ source: "amazon_originated", createdAt: "2026-05-01" }), // in
      opp({ source: "amazon_originated", createdAt: "2026-02-01" }), // before -> out
      opp({ source: "partner_originated", createdAt: "2026-05-01" }), // wrong source -> out
    ]);
    expect(m.measure(d, start)).toBe(1);
  });

  it("open_pipeline_value reads current open value (ignores period)", () => {
    const m = metricByKey("open_pipeline_value")!;
    const d = data([
      opp({ status: "open", amount: 40_000 }),
      opp({ status: "open", amount: 10_000 }),
      opp({ status: "won", amount: 99_000 }),
    ]);
    expect(m.windowed).toBe(false);
    expect(m.measure(d, start)).toBe(50_000);
  });

  it("win_rate is won/(won+lost) percent, 0 when nothing closed", () => {
    const m = metricByKey("win_rate")!;
    expect(m.measure(data([opp({ status: "won" }), opp({ status: "won" }), opp({ status: "lost" })]), start)).toBe(67);
    expect(m.measure(data([opp({ status: "open" })]), start)).toBe(0);
  });

  it("measureGoal dispatches by key and returns 0 for unknown keys", () => {
    const d = data([opp({ status: "won", amount: 25_000, closeDate: "2026-05-01" })]);
    expect(measureGoal({ metricKey: "total_revenue", periodStart: start }, d)).toBe(25_000);
    expect(measureGoal({ metricKey: "ghost_metric", periodStart: start }, d)).toBe(0);
  });

  it("formats values by unit", () => {
    expect(formatMetricValue("currency", 1_250_000)).toBe("$1,250,000");
    expect(formatMetricValue("count", 12)).toBe("12");
    expect(formatMetricValue("percent", 73)).toBe("73%");
  });
});
