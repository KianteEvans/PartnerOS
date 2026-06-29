import { daysBetween } from "@/domain/dates";

/**
 * Pure goal-progress engine. Given a goal (target + period + optional deadline)
 * and its current measured value, derive percent-to-target, status, and deadline
 * pacing. No DB, no clock — `today` is passed in (YYYY-MM-DD).
 *
 * Status: `achieved` once current >= target; otherwise, when a deadline exists,
 * compare actual progress to the time-elapsed pace (ahead / on_track / behind);
 * with no deadline it's simply `in_progress`.
 */

export type GoalStatus = "achieved" | "ahead" | "on_track" | "behind" | "in_progress";

export interface GoalForProgress {
  readonly targetValue: number;
  readonly periodStart: string;
  readonly targetDeadline: string | null;
}

export interface GoalProgress {
  readonly current: number;
  readonly target: number;
  /** 0-100, capped — drives the progress bar width. */
  readonly percent: number;
  /** Uncapped percent (can exceed 100 when the target is beaten). */
  readonly rawPercent: number;
  /** max(0, target - current). */
  readonly remaining: number;
  readonly status: GoalStatus;
  /** Whole days until the deadline (negative if past); null if no deadline. */
  readonly daysToDeadline: number | null;
  /** The pace line: expected percent given elapsed time; null if no deadline. */
  readonly expectedPercent: number | null;
}

/** +/- percentage points around the pace line that still counts as "on track". */
const PACE_SLACK = 10;

export function goalProgress(
  goal: GoalForProgress,
  current: number,
  today: string,
): GoalProgress {
  const target = goal.targetValue;
  const rawPercentExact = target > 0 ? (current / target) * 100 : current > 0 ? 100 : 0;
  const percent = Math.max(0, Math.min(100, Math.round(rawPercentExact)));
  const remaining = Math.max(0, target - current);
  const daysToDeadline = goal.targetDeadline ? daysBetween(today, goal.targetDeadline) : null;

  let status: GoalStatus;
  let expectedPercent: number | null = null;
  if (target > 0 && current >= target) {
    status = "achieved";
  } else if (goal.targetDeadline) {
    const totalDays = daysBetween(goal.periodStart, goal.targetDeadline);
    const elapsedDays = daysBetween(goal.periodStart, today);
    expectedPercent =
      totalDays <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((elapsedDays / totalDays) * 100)));
    if (rawPercentExact >= expectedPercent + PACE_SLACK) status = "ahead";
    else if (rawPercentExact < expectedPercent - PACE_SLACK) status = "behind";
    else status = "on_track";
  } else {
    status = "in_progress";
  }

  return {
    current,
    target,
    percent,
    rawPercent: Math.round(rawPercentExact),
    remaining,
    status,
    daysToDeadline,
    expectedPercent,
  };
}

export const STATUS_LABELS: Record<GoalStatus, string> = {
  achieved: "Achieved",
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  in_progress: "In progress",
};

export type StatusTone = "ok" | "info" | "warn" | "danger" | "neutral";

/** Tone for the status Badge + progress bar. Kept UI-free (string literals) so the
 *  domain layer doesn't depend on the component layer. */
export const STATUS_TONE: Record<GoalStatus, StatusTone> = {
  achieved: "ok",
  ahead: "ok",
  on_track: "info",
  behind: "warn",
  in_progress: "neutral",
};
