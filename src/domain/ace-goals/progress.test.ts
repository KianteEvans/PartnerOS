import { describe, it, expect } from "vitest";
import { goalProgress, STATUS_TONE } from "@/domain/ace-goals/progress";

const start = "2026-01-01";
const today = "2026-07-01"; // ~50% through a full year

describe("goalProgress", () => {
  it("marks a met target as achieved with capped percent", () => {
    const p = goalProgress({ targetValue: 100, periodStart: start, targetDeadline: "2026-12-31" }, 120, today);
    expect(p.status).toBe("achieved");
    expect(p.percent).toBe(100); // capped for the bar
    expect(p.rawPercent).toBe(120); // uncapped
    expect(p.remaining).toBe(0);
    expect(STATUS_TONE[p.status]).toBe("ok");
  });

  it("is ahead when progress outpaces the elapsed-time pace", () => {
    // ~50% of the year elapsed; 80% done -> ahead.
    const p = goalProgress({ targetValue: 100, periodStart: start, targetDeadline: "2026-12-31" }, 80, today);
    expect(p.status).toBe("ahead");
    expect(p.expectedPercent).toBeGreaterThan(45);
    expect(p.expectedPercent).toBeLessThan(55);
  });

  it("is behind when progress trails the pace", () => {
    // ~50% elapsed; 10% done -> behind.
    const p = goalProgress({ targetValue: 100, periodStart: start, targetDeadline: "2026-12-31" }, 10, today);
    expect(p.status).toBe("behind");
    expect(STATUS_TONE[p.status]).toBe("warn");
  });

  it("is on_track within the pace slack", () => {
    // ~50% elapsed; ~50% done -> on track.
    const p = goalProgress({ targetValue: 100, periodStart: start, targetDeadline: "2026-12-31" }, 50, today);
    expect(p.status).toBe("on_track");
  });

  it("with no deadline reports in_progress and no pace", () => {
    const p = goalProgress({ targetValue: 100, periodStart: start, targetDeadline: null }, 40, today);
    expect(p.status).toBe("in_progress");
    expect(p.expectedPercent).toBeNull();
    expect(p.daysToDeadline).toBeNull();
    expect(p.remaining).toBe(60);
  });

  it("computes days to deadline (negative once past)", () => {
    const past = goalProgress({ targetValue: 100, periodStart: start, targetDeadline: "2026-06-01" }, 30, today);
    expect(past.daysToDeadline).toBe(-30);
    expect(past.status).toBe("behind");
  });

  it("handles a zero target without dividing by zero", () => {
    const p = goalProgress({ targetValue: 0, periodStart: start, targetDeadline: null }, 0, today);
    expect(p.percent).toBe(0);
    expect(p.status).toBe("in_progress");
  });
});
