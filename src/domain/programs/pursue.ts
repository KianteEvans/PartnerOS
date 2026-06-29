import {
  computeReadinessGate,
  requirementProgress,
  type ReadinessGate,
  type RequirementState,
  type ProgramStatusValue,
} from "@/domain/programs/gate";

/**
 * Pure ranking for the Pursue "In pursuit" tracker: the in-flight competencies the
 * org is actively earning — `pending`/`submitted` only (earned/`active` programs are
 * surfaced in the Active pill + Maintain tab, not here). Ranked by readiness % so the
 * top of the list is whatever is closest to submission. No DB, no clock.
 */

export interface PursuitInput {
  readonly id: string;
  readonly name: string;
  readonly programType: string;
  readonly status: string;
  readonly expirationDate: string | null;
  readonly states: readonly RequirementState[];
}

export interface PursuitItem {
  readonly id: string;
  readonly name: string;
  readonly programType: string;
  readonly status: string;
  readonly gate: ReadinessGate;
  readonly met: number;
  readonly total: number;
  /** Readiness 0–100 (requirements met / total). */
  readonly percent: number;
}

/** In-flight = still being earned. Earned (`active`) / `expired` are excluded. */
function isInFlight(status: string): boolean {
  return status === "pending" || status === "submitted";
}

export function topPursued(
  items: readonly PursuitInput[],
  today: string,
  limit = 5,
): PursuitItem[] {
  return items
    .filter((p) => isInFlight(p.status))
    .map((p) => {
      const { met, total } = requirementProgress(p.states);
      return {
        id: p.id,
        name: p.name,
        programType: p.programType,
        status: p.status,
        gate: computeReadinessGate(p.status as ProgramStatusValue, p.states, p.expirationDate, today),
        met,
        total,
        percent: total > 0 ? Math.round((met / total) * 100) : 0,
      };
    })
    .sort(
      (a, b) =>
        b.percent - a.percent || // closest to earning first
        b.total - a.total || // more substantial programs win ties
        a.name.localeCompare(b.name), // deterministic final tiebreak
    )
    .slice(0, limit);
}
