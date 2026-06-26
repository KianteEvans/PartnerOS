import { describe, it, expect } from "vitest";
import {
  taskStatusToMilestone,
  milestoneStatusToTask,
} from "@/domain/roadmaps/status-sync";

describe("roadmap ↔ task status mapping", () => {
  it("maps task status to milestone status (open → planned, rest 1:1)", () => {
    expect(taskStatusToMilestone("open")).toBe("planned");
    expect(taskStatusToMilestone("in_progress")).toBe("in_progress");
    expect(taskStatusToMilestone("blocked")).toBe("blocked");
    expect(taskStatusToMilestone("done")).toBe("done");
  });

  it("maps milestone status to task status (planned → open, rest 1:1)", () => {
    expect(milestoneStatusToTask("planned")).toBe("open");
    expect(milestoneStatusToTask("in_progress")).toBe("in_progress");
    expect(milestoneStatusToTask("blocked")).toBe("blocked");
    expect(milestoneStatusToTask("done")).toBe("done");
  });

  it("round-trips the shared states", () => {
    for (const s of ["in_progress", "blocked", "done"] as const) {
      expect(milestoneStatusToTask(taskStatusToMilestone(s))).toBe(s);
    }
    // the entry states fold together (planned/open) but stay self-consistent
    expect(taskStatusToMilestone(milestoneStatusToTask("planned"))).toBe("planned");
    expect(milestoneStatusToTask(taskStatusToMilestone("open"))).toBe("open");
  });
});
