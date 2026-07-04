import { addDays, daysBetween } from "@/domain/dates";
import type { ProgressMilestone } from "@/domain/roadmaps/progress";

/**
 * Pure progress forecast for a roadmap. No database, no clock — the caller passes
 * `today`. Turns the milestone roll-up plus a daily burn-up series (the done-count
 * over time, captured on the detail page) into a trajectory: how fast milestones
 * are completing, when the roadmap will finish at that pace, whether that beats
 * the planned end, and which milestones are at risk. Deterministic and testable.
 *
 * Degrades gracefully: with a real velocity it projects from the burn-up; with
 * thin/flat/regressing history it falls back to a naive %-done-vs-elapsed estimate;
 * with no milestones it reports "none". Never divides by zero and never projects
 * beyond MAX_PROJECTION_DAYS.
 */

export interface SnapshotPoint {
  readonly capturedOn: string; // ISO YYYY-MM-DD
  readonly done: number;
}

export type ForecastBasis = "velocity" | "naive" | "complete" | "none";

export interface AtRiskMilestone {
  readonly title: string;
  readonly targetDate: string;
  readonly reason: "overdue" | "unreachable";
}

export interface ForecastMilestone extends ProgressMilestone {
  readonly title: string;
}

export interface ForecastInput {
  readonly milestones: readonly ForecastMilestone[];
  /** Chronological (oldest..newest) daily done-count snapshots. */
  readonly snapshots: readonly SnapshotPoint[];
  readonly today: string;
}

export interface RoadmapForecast {
  readonly total: number;
  readonly done: number;
  readonly remaining: number;
  readonly velocityPerDay: number | null;
  readonly projectedCompletionDate: string | null;
  readonly plannedEnd: string | null;
  /** projected <= plannedEnd; null when unknowable. */
  readonly onTrack: boolean | null;
  /** + ahead of / - behind plannedEnd, in days; null when unknowable. */
  readonly paceDays: number | null;
  readonly atRiskMilestones: readonly AtRiskMilestone[];
  readonly basis: ForecastBasis;
}

/** ~5y cap so a near-zero velocity can't overflow addDays into an absurd date. */
const MAX_PROJECTION_DAYS = 1830;

export function computeForecast(input: ForecastInput): RoadmapForecast {
  const { milestones, snapshots, today } = input;
  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "done").length;
  const remaining = total - done;

  let plannedEnd: string | null = null;
  for (const m of milestones) {
    if (plannedEnd === null || m.targetDate > plannedEnd) plannedEnd = m.targetDate;
  }

  if (total === 0) {
    return {
      total: 0, done: 0, remaining: 0, velocityPerDay: null,
      projectedCompletionDate: null, plannedEnd: null, onTrack: null,
      paceDays: null, atRiskMilestones: [], basis: "none",
    };
  }

  if (remaining === 0) {
    return {
      total, done, remaining: 0, velocityPerDay: null,
      projectedCompletionDate: today, plannedEnd,
      onTrack: true, paceDays: plannedEnd ? daysBetween(today, plannedEnd) : null,
      atRiskMilestones: [], basis: "complete",
    };
  }

  // Prefer a real velocity from the burn-up series.
  let velocityPerDay: number | null = null;
  let projectedCompletionDate: string | null = null;
  let basis: ForecastBasis;
  if (snapshots.length >= 2) {
    const first = snapshots[0]!;
    const last = snapshots[snapshots.length - 1]!;
    const deltaDone = last.done - first.done;
    const deltaDays = daysBetween(first.capturedOn, last.capturedOn);
    if (deltaDays >= 1 && deltaDone > 0) {
      velocityPerDay = deltaDone / deltaDays;
      const daysToFinish = Math.min(Math.ceil(remaining / velocityPerDay), MAX_PROJECTION_DAYS);
      projectedCompletionDate = addDays(today, daysToFinish);
      basis = "velocity";
    } else {
      basis = "naive";
    }
  } else {
    basis = "naive";
  }

  // Naive fallback: %-done vs elapsed horizon. Pure, no history needed.
  if (basis === "naive") {
    let start: string | null = null;
    for (const m of milestones) {
      if (start === null || m.targetDate < start) start = m.targetDate;
    }
    const fractionDone = done / total;
    if (fractionDone <= 0 || start === null) {
      projectedCompletionDate = null;
    } else {
      const elapsed = Math.max(1, daysBetween(start, today));
      const remainingDays = Math.max(0, Math.ceil(elapsed / fractionDone - elapsed));
      projectedCompletionDate = addDays(today, Math.min(remainingDays, MAX_PROJECTION_DAYS));
    }
  }

  let onTrack: boolean | null = null;
  let paceDays: number | null = null;
  if (projectedCompletionDate !== null && plannedEnd !== null) {
    paceDays = daysBetween(projectedCompletionDate, plannedEnd);
    onTrack = paceDays >= 0;
  }

  const atRiskMilestones: AtRiskMilestone[] = [];
  for (const m of milestones) {
    if (m.status === "done") continue;
    if (m.targetDate < today) {
      atRiskMilestones.push({ title: m.title, targetDate: m.targetDate, reason: "overdue" });
    } else if (projectedCompletionDate !== null && m.targetDate < projectedCompletionDate) {
      atRiskMilestones.push({ title: m.title, targetDate: m.targetDate, reason: "unreachable" });
    }
  }
  atRiskMilestones.sort((a, b) => (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0));

  return {
    total, done, remaining, velocityPerDay,
    projectedCompletionDate, plannedEnd, onTrack, paceDays,
    atRiskMilestones, basis,
  };
}
