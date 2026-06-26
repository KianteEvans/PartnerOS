import { addDays } from "@/domain/dates";

/**
 * Pure roadmap planning: turn a configuration (horizon, scenario, start date)
 * plus optional milestone seeds into a sequenced set of milestones with computed
 * target dates and a linear dependency chain (the critical path). No database,
 * no clock — deterministic and unit-testable.
 *
 * Milestones are spread across the horizon: milestone i of N targets
 * startDate + horizonDays * (i/N) * pace, where the scenario sets the pace
 * (accelerated front-loads, conservative uses the full window).
 */

export type HorizonId = "m3" | "m6" | "m9" | "m12" | "m18";
export type ScenarioId = "conservative" | "standard" | "accelerated";

export const HORIZON_MONTHS: Record<HorizonId, number> = {
  m3: 3,
  m6: 6,
  m9: 9,
  m12: 12,
  m18: 18,
};

export const HORIZON_LABELS: Record<HorizonId, string> = {
  m3: "3 months",
  m6: "6 months",
  m9: "9 months",
  m12: "12 months",
  m18: "18 months",
};

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  conservative: "Conservative",
  standard: "Standard",
  accelerated: "Accelerated",
};

/** Fraction of the horizon used to pace milestones; lower = earlier targets. */
const SCENARIO_PACE: Record<ScenarioId, number> = {
  conservative: 1.0,
  standard: 0.85,
  accelerated: 0.7,
};

const DAYS_PER_MONTH = 30;

export interface MilestoneSeed {
  readonly title: string;
  readonly detail: string;
}

export interface MilestoneDraft {
  readonly sequence: number;
  readonly title: string;
  readonly detail: string;
  /** ISO target date (YYYY-MM-DD). */
  readonly targetDate: string;
  /** Sequence number of the milestone this depends on, or null for the first. */
  readonly dependsOnSequence: number | null;
}

export interface RoadmapConfig {
  readonly horizon: HorizonId;
  readonly scenario: ScenarioId;
  /** ISO start date (YYYY-MM-DD). */
  readonly startDate: string;
  readonly objective: string;
}

/** A generic four-phase scaffold used when no seeds are supplied. */
export function defaultSeeds(objective: string): MilestoneSeed[] {
  const goal = objective.trim().length > 0 ? objective.trim() : "the objective";
  return [
    {
      title: "Establish baseline & owners",
      detail: "Confirm current posture, assign owners, and align on scope.",
    },
    {
      title: "Close priority readiness gaps",
      detail: `Address the highest-impact gaps blocking ${goal}.`,
    },
    {
      title: "Assemble evidence & approvals",
      detail: "Collect required evidence and route approvals.",
    },
    {
      title: "Submit & review outcomes",
      detail: `Submit for ${goal} and review results with stakeholders.`,
    },
  ];
}

/** Produce the sequenced milestone drafts for a roadmap. */
export function planRoadmap(
  config: RoadmapConfig,
  seeds: readonly MilestoneSeed[],
): MilestoneDraft[] {
  const effective = seeds.length > 0 ? seeds : defaultSeeds(config.objective);
  const n = effective.length;
  const horizonDays = HORIZON_MONTHS[config.horizon] * DAYS_PER_MONTH;
  const pace = SCENARIO_PACE[config.scenario];

  return effective.map((seed, i) => {
    const fraction = (i + 1) / n;
    const offset = Math.max(1, Math.round(horizonDays * fraction * pace));
    return {
      sequence: i + 1,
      title: seed.title,
      detail: seed.detail,
      targetDate: addDays(config.startDate, offset),
      dependsOnSequence: i === 0 ? null : i, // previous milestone's sequence
    };
  });
}
