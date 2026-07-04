import { deriveDecisions, type Decision } from "@/domain/command/brief";
import { healthScore, type Health } from "@/domain/command/health";
import { addDays } from "@/domain/dates";
import type { CommandInputs } from "@/domain/command/types";

/**
 * Pure "what breaks next" outlook: re-run the SAME decision queue + health score at
 * future dates (both are clock-injected) and report what NEWLY fires at each horizon
 * if nothing is done — deadlines crossing, claims lapsing, milestones slipping, deals
 * going stale. Each emerging risk is attributed to the FIRST horizon where it appears.
 * Date-driven decay only: static inputs (e.g. funding re-match candidates) don't
 * re-derive, so this projects erosion, not new opportunities. No database, no clock.
 */

export const HORIZONS = [30, 60, 90] as const;

/** Emerging decisions shown per horizon; the rest roll into `emergingTotal`. */
export const MAX_EMERGING = 6;

export interface HorizonOutlook {
  readonly days: number;
  readonly date: string;
  readonly health: number;
  readonly healthDelta: number;
  readonly band: Health["band"];
  /** Decisions that fire by this horizon but not today (severity-ordered, capped). */
  readonly emerging: readonly Decision[];
  readonly emergingTotal: number;
}

export interface BreakageOutlook {
  readonly baselineHealth: number;
  readonly horizons: readonly HorizonOutlook[];
}

export function whatBreaksNext(inputs: CommandInputs, today: string): BreakageOutlook {
  const baselineHealth = healthScore(inputs, today).score;
  const seen = new Set(deriveDecisions(inputs, today).map((d) => d.id));

  const horizons: HorizonOutlook[] = [];
  for (const days of HORIZONS) {
    const date = addDays(today, days);
    const future = deriveDecisions(inputs, date);
    const emerging = future.filter((d) => !seen.has(d.id));
    for (const d of emerging) seen.add(d.id); // attribute to the first horizon only
    const h = healthScore(inputs, date);
    horizons.push({
      days,
      date,
      health: h.score,
      healthDelta: h.score - baselineHealth,
      band: h.band,
      emerging: emerging.slice(0, MAX_EMERGING),
      emergingTotal: emerging.length,
    });
  }

  return { baselineHealth, horizons };
}
