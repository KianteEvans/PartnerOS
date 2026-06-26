import { describe, it, expect } from "vitest";
import {
  roadmapProgress,
  isMilestoneOverdue,
  type MilestoneStatusValue,
} from "@/domain/roadmaps/progress";

const TODAY = "2026-06-24";
const m = (status: MilestoneStatusValue, targetDate: string) => ({ status, targetDate });

describe("roadmap progress", () => {
  it("an empty roadmap is 0% with no next-due", () => {
    expect(roadmapProgress([], TODAY)).toMatchObject({
      total: 0,
      done: 0,
      percentDone: 0,
      overdue: 0,
      nextDue: null,
    });
  });

  it("counts statuses and percent done", () => {
    const p = roadmapProgress(
      [
        m("done", "2026-05-01"),
        m("done", "2026-05-15"),
        m("in_progress", "2026-07-01"),
        m("blocked", "2026-04-01"),
        m("planned", "2026-08-01"),
      ],
      TODAY,
    );
    expect(p.total).toBe(5);
    expect(p.done).toBe(2);
    expect(p.inProgress).toBe(1);
    expect(p.blocked).toBe(1);
    expect(p.planned).toBe(1);
    expect(p.percentDone).toBe(40);
  });

  it("flags overdue only when past the target date and not done", () => {
    expect(isMilestoneOverdue(m("planned", "2026-06-01"), TODAY)).toBe(true);
    expect(isMilestoneOverdue(m("blocked", "2026-06-01"), TODAY)).toBe(true);
    expect(isMilestoneOverdue(m("done", "2026-06-01"), TODAY)).toBe(false);
    expect(isMilestoneOverdue(m("planned", "2026-12-01"), TODAY)).toBe(false);
  });

  it("counts overdue and the earliest not-done due date", () => {
    const p = roadmapProgress(
      [
        m("done", "2026-01-01"),
        m("blocked", "2026-04-01"),
        m("planned", "2026-06-01"),
        m("in_progress", "2026-09-01"),
      ],
      TODAY,
    );
    expect(p.overdue).toBe(2);
    expect(p.nextDue).toBe("2026-04-01");
  });
});
