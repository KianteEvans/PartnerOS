import { addDays, daysBetween } from "@/domain/dates";
import { gapFor, type RequirementValue } from "@/domain/tiers/gap";
import { planRoadmap, type HorizonId, type ScenarioId } from "@/domain/roadmaps/planner";

/**
 * Pure Tier Path Simulator: turn the current tier requirements into a FORWARD,
 * dated advancement plan — three effort scenarios with ETAs, a velocity reality-check
 * off historical tier %, owner-capacity/bottleneck detection, and a fewest-effort
 * competency stack for a competency-count requirement. No database, no clock — the
 * caller passes `today`. Deterministic and unit-testable. Advisory only (never writes).
 *
 * ETA = effort × pace (via the roadmap `planRoadmap` pacing), NOT extrapolated history,
 * so it works for a brand-new plan with no trend yet; `tierVelocity` is a secondary
 * "am I actually on pace" signal that lights up once tier % has moved.
 */

export type TierScenarioId = "aggressive" | "steady" | "deliberate";

interface ScenarioPreset {
  readonly id: TierScenarioId;
  readonly label: string;
  readonly horizon: HorizonId;
  readonly scenario: ScenarioId;
}

/** Same requirements, different pace/horizon → a spread of realistic ETAs. */
export const TIER_SCENARIOS: readonly ScenarioPreset[] = [
  { id: "aggressive", label: "Aggressive", horizon: "m3", scenario: "accelerated" },
  { id: "steady", label: "Steady", horizon: "m6", scenario: "standard" },
  { id: "deliberate", label: "Deliberate", horizon: "m9", scenario: "conservative" },
];

export interface PathStep {
  readonly key: string;
  readonly label: string;
  readonly targetDate: string;
  /** 0–100 progress toward this requirement's threshold. */
  readonly progress: number;
  readonly detail: string;
}

export interface TierScenario {
  readonly id: TierScenarioId;
  readonly label: string;
  readonly etaDate: string | null;
  readonly steps: readonly PathStep[];
}

export interface TierPath {
  /** True when there are no unmet gating requirements left. */
  readonly achievable: boolean;
  readonly remaining: number;
  readonly scenarios: readonly TierScenario[];
}

/** Unmet gating requirements, closest-to-threshold first (front-load quick wins). */
function orderClosestFirst(reqs: readonly RequirementValue[]): RequirementValue[] {
  return reqs
    .filter((r) => !r.informational && !gapFor(r).met)
    .slice()
    .sort((a, b) => gapFor(b).progress - gapFor(a).progress || a.key.localeCompare(b.key));
}

export function tierPath(
  reqs: readonly RequirementValue[],
  today: string,
  targetLabel: string,
): TierPath {
  const unmet = orderClosestFirst(reqs);
  if (unmet.length === 0) return { achievable: true, remaining: 0, scenarios: [] };

  const seeds = unmet.map((r) => ({ title: r.label, detail: "" }));
  const scenarios = TIER_SCENARIOS.map((p) => {
    const drafts = planRoadmap(
      { horizon: p.horizon, scenario: p.scenario, startDate: today, objective: `Reach ${targetLabel}` },
      seeds,
    );
    const steps: PathStep[] = unmet.map((r, i) => ({
      key: r.key,
      label: r.label,
      targetDate: drafts[i]?.targetDate ?? today,
      progress: gapFor(r).progress,
      detail: r.kind === "boolean" ? "Complete this requirement" : `${r.currentValue}/${r.threshold}`,
    }));
    const last = steps[steps.length - 1];
    return { id: p.id, label: p.label, etaDate: last ? last.targetDate : null, steps };
  });
  return { achievable: false, remaining: unmet.length, scenarios };
}

// --- Velocity reality-check (off metricSnapshots.tierPercent history) -----------

export type VelocityBand = "on_track" | "slow" | "none";

export interface TierVelocity {
  /** Tier-% gained per day over the window, or null when there's no positive trend. */
  readonly velocityPerDay: number | null;
  readonly projectedDate: string | null;
  readonly band: VelocityBand;
}

export function tierVelocity(
  history: readonly { readonly capturedOn: string; readonly percent: number }[],
  currentPercent: number,
  today: string,
  targetDate: string | null = null,
): TierVelocity {
  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last || history.length < 2 || currentPercent >= 100) {
    return { velocityPerDay: null, projectedDate: null, band: "none" };
  }
  const days = daysBetween(first.capturedOn, last.capturedOn);
  const gained = last.percent - first.percent;
  if (days <= 0 || gained <= 0) return { velocityPerDay: null, projectedDate: null, band: "none" };
  const velocityPerDay = gained / days;
  const projectedDate = addDays(today, Math.ceil((100 - currentPercent) / velocityPerDay));
  const band: VelocityBand = targetDate !== null && projectedDate > targetDate ? "slow" : "on_track";
  return { velocityPerDay: Math.round(velocityPerDay * 100) / 100, projectedDate, band };
}

// --- Owner capacity / bottleneck ------------------------------------------------

export interface OwnerLoad {
  readonly ownerUserId: string | null;
  readonly count: number;
  readonly labels: readonly string[];
}

export interface Capacity {
  readonly loads: readonly OwnerLoad[];
  readonly unowned: number;
  /** True when work is unowned or one owner holds ≥ half of it. */
  readonly bottleneck: boolean;
}

export function ownerLoad(
  items: readonly { readonly ownerUserId: string | null; readonly label: string }[],
): Capacity {
  const byOwner = new Map<string | null, { count: number; labels: string[] }>();
  for (const it of items) {
    const cur = byOwner.get(it.ownerUserId) ?? { count: 0, labels: [] };
    cur.count += 1;
    cur.labels.push(it.label);
    byOwner.set(it.ownerUserId, cur);
  }
  const loads: OwnerLoad[] = [...byOwner.entries()]
    .map(([ownerUserId, v]) => ({ ownerUserId, count: v.count, labels: v.labels }))
    .sort((a, b) => b.count - a.count);
  const unowned = byOwner.get(null)?.count ?? 0;
  const topOwned = loads.find((l) => l.ownerUserId !== null);
  const bottleneck =
    unowned > 0 || (items.length >= 3 && topOwned !== undefined && topOwned.count >= Math.ceil(items.length / 2));
  return { loads, unowned, bottleneck };
}

// --- Cheapest competency stack (for a competency-count requirement) --------------

export interface CompetencyOption {
  readonly programKey: string;
  readonly name: string;
  readonly programType: string;
  readonly gapCount: number;
  readonly coveragePercent: number;
}

/**
 * Pick the `need` not-yet-adopted competencies that take the least work to earn
 * (fewest evidence gaps, then best current coverage). Reuses the fit engine's output.
 */
export function cheapestCompetencyStack(
  options: readonly CompetencyOption[],
  need: number,
  adopted: ReadonlySet<string>,
): CompetencyOption[] {
  if (need <= 0) return [];
  return options
    .filter((o) => !adopted.has(o.programKey) && (o.programType === "Competency" || o.programType === "Specialization"))
    .slice()
    .sort((a, b) => a.gapCount - b.gapCount || b.coveragePercent - a.coveragePercent || a.name.localeCompare(b.name))
    .slice(0, need);
}
