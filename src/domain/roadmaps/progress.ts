import { addDays } from "@/domain/dates";

/**
 * Pure roadmap progress + overdue rollup. No database, no clock — the caller
 * passes `today`. Drives the detail-page progress header, the timeline's overdue
 * flagging, and the per-milestone overdue badge. Deterministic and testable.
 */

export type MilestoneStatusValue = "planned" | "in_progress" | "done" | "blocked";

/** Default look-ahead window for "due soon" milestone warnings. */
export const MILESTONE_UPCOMING_WINDOW_DAYS = 7;

export interface ProgressMilestone {
  readonly status: MilestoneStatusValue;
  /** ISO target date (YYYY-MM-DD). */
  readonly targetDate: string;
}

export interface RoadmapProgress {
  readonly total: number;
  readonly done: number;
  readonly inProgress: number;
  readonly blocked: number;
  readonly planned: number;
  /** Percent of milestones complete, 0-100. */
  readonly percentDone: number;
  /** Milestones past their target date and not yet done. */
  readonly overdue: number;
  /** Earliest target date among not-done milestones, or null. */
  readonly nextDue: string | null;
}

/** A milestone is overdue when it is past its target date and not done. */
export function isMilestoneOverdue(
  m: ProgressMilestone,
  today: string,
): boolean {
  return m.status !== "done" && m.targetDate < today;
}

/**
 * A milestone is "due soon" when it is not done, not yet overdue, and its target
 * date falls within the look-ahead window — the early-warning state that precedes
 * overdue. Mutually exclusive with isMilestoneOverdue.
 */
export function isMilestoneUpcoming(
  m: ProgressMilestone,
  today: string,
  windowDays: number = MILESTONE_UPCOMING_WINDOW_DAYS,
): boolean {
  return m.status !== "done" && m.targetDate >= today && m.targetDate <= addDays(today, windowDays);
}

export function roadmapProgress(
  milestones: readonly ProgressMilestone[],
  today: string,
): RoadmapProgress {
  const total = milestones.length;
  let done = 0;
  let inProgress = 0;
  let blocked = 0;
  let planned = 0;
  let overdue = 0;
  let nextDue: string | null = null;

  for (const m of milestones) {
    if (m.status === "done") done += 1;
    else if (m.status === "in_progress") inProgress += 1;
    else if (m.status === "blocked") blocked += 1;
    else planned += 1;

    if (isMilestoneOverdue(m, today)) overdue += 1;
    if (m.status !== "done" && (nextDue === null || m.targetDate < nextDue)) {
      nextDue = m.targetDate;
    }
  }

  const percentDone = total === 0 ? 0 : Math.round((done / total) * 100);
  return {
    total,
    done,
    inProgress,
    blocked,
    planned,
    percentDone,
    overdue,
    nextDue,
  };
}
