import type { MilestoneStatusValue } from "@/domain/roadmaps/progress";

/**
 * Pure status mapping between a roadmap milestone and its finalize-spawned task,
 * so the two stay in lock-step ("close the loop"). The enums are a bijection
 * except the entry state: task `open` ↔ milestone `planned`; the other three
 * (`in_progress` / `blocked` / `done`) are shared and map 1:1. The DB sync
 * itself lives in each op (a direct write to the other domain's table); these
 * functions just translate the value, so they are deterministic and testable.
 */

export type TaskStatusValue = "open" | "in_progress" | "blocked" | "done";

export function taskStatusToMilestone(s: TaskStatusValue): MilestoneStatusValue {
  return s === "open" ? "planned" : s;
}

export function milestoneStatusToTask(s: MilestoneStatusValue): TaskStatusValue {
  return s === "planned" ? "open" : s;
}
