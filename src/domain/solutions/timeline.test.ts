import { describe, it, expect } from "vitest";
import { renewalAxis, type RenewalTimelineInput } from "@/domain/solutions/timeline";

const item = (over: Partial<RenewalTimelineInput>): RenewalTimelineInput => ({
  id: "s1",
  title: "Sol",
  band: "compliant",
  renewalDate: null,
  ...over,
});

describe("renewalAxis", () => {
  it("orders dated solutions and positions them 0–100 with today inside the axis", () => {
    const axis = renewalAxis(
      [
        item({ id: "late", title: "Late", renewalDate: "2026-09-01" }),
        item({ id: "early", title: "Early", renewalDate: "2026-03-01" }),
      ],
      "2026-06-01",
    );
    expect(axis.points.map((p) => p.id)).toEqual(["early", "late"]); // sorted by date
    expect(axis.points[0]!.pct).toBeLessThan(axis.points[1]!.pct);
    for (const p of axis.points) {
      expect(p.pct).toBeGreaterThanOrEqual(0);
      expect(p.pct).toBeLessThanOrEqual(100);
    }
    // today (Jun) sits between Mar and Sep -> strictly inside the axis.
    expect(axis.todayPct).toBeGreaterThan(0);
    expect(axis.todayPct).toBeLessThan(100);
    expect(axis.undated).toHaveLength(0);
  });

  it("keeps today on the axis even when all renewals are in the past", () => {
    const axis = renewalAxis([item({ renewalDate: "2026-01-01" })], "2026-06-01");
    // today is after the only (padded) renewal -> near the right edge, still <= 100.
    expect(axis.todayPct).toBeGreaterThan(50);
    expect(axis.todayPct).toBeLessThanOrEqual(100);
  });

  it("splits out undated solutions and degrades to an empty axis", () => {
    const axis = renewalAxis(
      [item({ id: "a", renewalDate: null }), item({ id: "b", renewalDate: null })],
      "2026-06-01",
    );
    expect(axis.points).toHaveLength(0);
    expect(axis.undated.map((u) => u.id)).toEqual(["a", "b"]);
    expect(axis.start).toBe("2026-06-01");
    expect(axis.end).toBe("2026-06-01");
  });
});
