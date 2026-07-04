import { describe, it, expect } from "vitest";
import { computeForecast, type ForecastMilestone, type SnapshotPoint } from "@/domain/roadmaps/forecast";
import { addDays } from "@/domain/dates";

const TODAY = "2026-06-24";

const m = (
  status: ForecastMilestone["status"],
  targetDate: string,
  title = "x",
): ForecastMilestone => ({ status, targetDate, title });
const s = (capturedOn: string, done: number): SnapshotPoint => ({ capturedOn, done });

describe("computeForecast", () => {
  it("falls back to a naive estimate with no snapshot history", () => {
    const f = computeForecast({
      milestones: [m("done", "2026-05-01"), m("planned", "2026-07-01"), m("planned", "2026-08-01"), m("planned", "2026-09-01")],
      snapshots: [],
      today: TODAY,
    });
    expect(f.basis).toBe("naive");
    expect(f.velocityPerDay).toBeNull();
    expect(f.projectedCompletionDate).not.toBeNull();
  });

  it("reports 'none' for a roadmap with no milestones", () => {
    const f = computeForecast({ milestones: [], snapshots: [], today: TODAY });
    expect(f.basis).toBe("none");
    expect(f.onTrack).toBeNull();
    expect(f.projectedCompletionDate).toBeNull();
    expect(f.atRiskMilestones).toEqual([]);
  });

  it("reports 'complete' when every milestone is done", () => {
    const f = computeForecast({
      milestones: [m("done", "2026-05-01"), m("done", "2026-06-01")],
      snapshots: [],
      today: TODAY,
    });
    expect(f.basis).toBe("complete");
    expect(f.projectedCompletionDate).toBe(TODAY);
    expect(f.onTrack).toBe(true);
    expect(f.remaining).toBe(0);
  });

  it("cannot project with no progress but still flags overdue milestones", () => {
    const f = computeForecast({
      milestones: [m("planned", "2026-01-01"), m("planned", "2026-02-01"), m("planned", "2026-12-01")],
      snapshots: [],
      today: TODAY,
    });
    expect(f.projectedCompletionDate).toBeNull();
    expect(f.onTrack).toBeNull();
    expect(f.atRiskMilestones.filter((a) => a.reason === "overdue")).toHaveLength(2);
  });

  it("projects ahead of plan from a healthy velocity", () => {
    const f = computeForecast({
      milestones: [
        m("done", "2026-05-01"),
        m("done", "2026-05-15"),
        m("done", "2026-06-01"),
        m("planned", "2026-12-01"),
        m("planned", "2026-12-15"),
      ],
      snapshots: [s("2026-06-18", 0), s("2026-06-20", 1), s("2026-06-22", 2), s("2026-06-24", 3)],
      today: TODAY,
    });
    expect(f.basis).toBe("velocity");
    expect(f.velocityPerDay).toBeCloseTo(0.5);
    expect(f.onTrack).toBe(true);
    expect(f.paceDays).toBeGreaterThan(0);
  });

  it("projects behind plan from a slow velocity and flags unreachable milestones", () => {
    const f = computeForecast({
      milestones: [
        m("done", "2026-05-01"),
        m("planned", "2026-07-01"),
        m("planned", "2026-07-05"),
        m("planned", "2026-07-10"),
      ],
      snapshots: [s("2026-06-10", 0), s("2026-06-24", 1)],
      today: TODAY,
    });
    expect(f.basis).toBe("velocity");
    expect(f.onTrack).toBe(false);
    expect(f.paceDays).toBeLessThan(0);
    expect(f.atRiskMilestones.some((a) => a.reason === "unreachable")).toBe(true);
  });

  it("falls back to naive when the burn-up is flat", () => {
    const f = computeForecast({
      milestones: [m("done", "2026-05-01"), m("done", "2026-05-10"), m("planned", "2026-09-01")],
      snapshots: [s("2026-06-10", 2), s("2026-06-17", 2), s("2026-06-24", 2)],
      today: TODAY,
    });
    expect(f.basis).toBe("naive");
  });

  it("ignores a regressing series (re-open) and never leaks negative velocity", () => {
    const f = computeForecast({
      milestones: [m("done", "2026-05-01"), m("done", "2026-05-10"), m("planned", "2026-09-01")],
      snapshots: [s("2026-06-17", 3), s("2026-06-24", 2)],
      today: TODAY,
    });
    expect(f.basis).toBe("naive");
    expect(f.velocityPerDay).toBeNull();
  });

  it("falls back to naive with a single snapshot", () => {
    const f = computeForecast({
      milestones: [m("done", "2026-05-01"), m("planned", "2026-09-01")],
      snapshots: [s("2026-06-24", 1)],
      today: TODAY,
    });
    expect(f.basis).toBe("naive");
  });

  it("orders at-risk milestones by date and does not double-count", () => {
    const f = computeForecast({
      milestones: [m("done", "2026-05-01"), m("planned", "2026-01-15"), m("planned", "2026-06-30")],
      snapshots: [s("2026-06-10", 0), s("2026-06-24", 1)],
      today: TODAY,
    });
    expect(f.atRiskMilestones.map((a) => a.targetDate)).toEqual(["2026-01-15", "2026-06-30"]);
    expect(f.atRiskMilestones[0]!.reason).toBe("overdue");
    expect(f.atRiskMilestones[1]!.reason).toBe("unreachable");
  });

  it("treats an exact landing on the planned end as on-track with zero pace", () => {
    const f = computeForecast({
      milestones: [m("done", "2026-05-01"), m("planned", "2026-06-28")],
      snapshots: [s("2026-06-20", 0), s("2026-06-24", 1)], // 0.25/day -> 4 days to finish 1
      today: TODAY,
    });
    expect(f.projectedCompletionDate).toBe("2026-06-28");
    expect(f.paceDays).toBe(0);
    expect(f.onTrack).toBe(true);
  });

  it("bounds the projection at MAX_PROJECTION_DAYS for a tiny velocity", () => {
    const milestones: ForecastMilestone[] = [m("done", "2026-05-01")];
    for (let i = 0; i < 200; i += 1) milestones.push(m("planned", "2027-01-01"));
    const f = computeForecast({
      milestones,
      snapshots: [s("2026-06-10", 0), s("2026-06-24", 1)],
      today: TODAY,
    });
    expect(f.projectedCompletionDate).toBe(addDays(TODAY, 1830));
  });
});
