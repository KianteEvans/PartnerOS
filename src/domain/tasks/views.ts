import { addDays } from "@/domain/dates";

/**
 * Pure task-view logic: given a flat task list and a reference "today", derive
 * the membership of each Task Manager view and a stable ordering. No database,
 * no clock — the caller passes `today` (YYYY-MM-DD), which keeps this fully
 * deterministic and unit-testable.
 */

export { addDays };

export type TaskView =
  | "all"
  | "mine"
  | "overdue"
  | "due_this_week"
  | "completed";

export const TASK_VIEWS: readonly TaskView[] = [
  "all",
  "mine",
  "overdue",
  "due_this_week",
  "completed",
];

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  all: "All open",
  mine: "My tasks",
  overdue: "Overdue",
  due_this_week: "Due this week",
  completed: "Completed",
};

type Status = "open" | "in_progress" | "blocked" | "done";
type Priority = "low" | "medium" | "high" | "critical";

/** The minimal task shape the view logic needs. */
export interface TaskLike {
  readonly status: Status;
  readonly priority: Priority;
  readonly ownerUserId: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  readonly dueDate: string | null;
  readonly createdAt: Date;
}

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function isOverdue(task: TaskLike, today: string): boolean {
  return (
    task.status !== "done" &&
    task.dueDate !== null &&
    task.dueDate < today
  );
}

export function isDueThisWeek(task: TaskLike, today: string): boolean {
  if (task.status === "done" || task.dueDate === null) return false;
  const weekEnd = addDays(today, 7);
  return task.dueDate >= today && task.dueDate <= weekEnd;
}

function matchesView(
  task: TaskLike,
  view: TaskView,
  userId: string,
  today: string,
): boolean {
  switch (view) {
    case "all":
      return task.status !== "done";
    case "mine":
      return task.status !== "done" && task.ownerUserId === userId;
    case "overdue":
      return isOverdue(task, today);
    case "due_this_week":
      return isDueThisWeek(task, today);
    case "completed":
      return task.status === "done";
  }
}

/**
 * Sort: highest priority first, then soonest due date (nulls last), then oldest
 * created. Stable and deterministic.
 */
function compareTasks(a: TaskLike, b: TaskLike): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export interface ViewContext {
  readonly userId: string;
  /** Reference date, YYYY-MM-DD. */
  readonly today: string;
}

/** Filter to a view and sort. Pure. */
export function filterTasks<T extends TaskLike>(
  tasks: readonly T[],
  view: TaskView,
  ctx: ViewContext,
): T[] {
  return tasks
    .filter((t) => matchesView(t, view, ctx.userId, ctx.today))
    .sort(compareTasks);
}

/** Counts per view, for the tab badges. */
export function viewCounts(
  tasks: readonly TaskLike[],
  ctx: ViewContext,
): Record<TaskView, number> {
  const counts = {
    all: 0,
    mine: 0,
    overdue: 0,
    due_this_week: 0,
    completed: 0,
  } as Record<TaskView, number>;
  for (const view of TASK_VIEWS) {
    counts[view] = tasks.filter((t) =>
      matchesView(t, view, ctx.userId, ctx.today),
    ).length;
  }
  return counts;
}
