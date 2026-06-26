import { describe, it, expect } from "vitest";
import {
  addDays,
  isOverdue,
  isDueThisWeek,
  filterTasks,
  viewCounts,
  type TaskLike,
} from "@/domain/tasks/views";

const TODAY = "2026-06-23";
const U1 = "user-1";
const U2 = "user-2";

function task(over: Partial<TaskLike>): TaskLike {
  return {
    status: "open",
    priority: "medium",
    ownerUserId: U1,
    dueDate: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

// A: overdue, high, owner U1
const a = task({ priority: "high", ownerUserId: U1, dueDate: "2026-06-20" });
// B: due this week, medium, owner U2
const b = task({ priority: "medium", ownerUserId: U2, dueDate: "2026-06-25" });
// C: completed, low, owner U1
const c = task({ status: "done", priority: "low", ownerUserId: U1, dueDate: "2026-06-01" });
// D: in progress, critical, no due date, owner U1
const d = task({ status: "in_progress", priority: "critical", ownerUserId: U1, dueDate: null });

const ALL = [a, b, c, d];
const ctx = { userId: U1, today: TODAY };

describe("task views", () => {
  it("addDays advances an ISO date", () => {
    expect(addDays(TODAY, 7)).toBe("2026-06-30");
    expect(addDays("2026-12-29", 5)).toBe("2027-01-03");
  });

  it("isOverdue / isDueThisWeek respect status and window", () => {
    expect(isOverdue(a, TODAY)).toBe(true);
    expect(isOverdue(c, TODAY)).toBe(false); // done is never overdue
    expect(isDueThisWeek(b, TODAY)).toBe(true);
    expect(isDueThisWeek(task({ dueDate: TODAY }), TODAY)).toBe(true); // inclusive
    expect(isDueThisWeek(task({ dueDate: "2026-07-01" }), TODAY)).toBe(false); // > +7
  });

  it("'all' excludes done and sorts by priority then due date", () => {
    const out = filterTasks(ALL, "all", ctx);
    expect(out).toEqual([d, a, b]); // critical, high, medium
  });

  it("'mine' returns the caller's open tasks", () => {
    const out = filterTasks(ALL, "mine", ctx);
    expect(out).toEqual([d, a]); // U1's open tasks, by priority
  });

  it("'overdue', 'due_this_week', 'completed' partition correctly", () => {
    expect(filterTasks(ALL, "overdue", ctx)).toEqual([a]);
    expect(filterTasks(ALL, "due_this_week", ctx)).toEqual([b]);
    expect(filterTasks(ALL, "completed", ctx)).toEqual([c]);
  });

  it("viewCounts matches the filtered sizes", () => {
    expect(viewCounts(ALL, ctx)).toEqual({
      all: 3,
      mine: 2,
      overdue: 1,
      due_this_week: 1,
      completed: 1,
    });
  });
});
