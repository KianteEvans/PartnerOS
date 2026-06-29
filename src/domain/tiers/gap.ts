import { TIER_ORDER, type TierId } from "@/domain/tiers/catalog";

/**
 * Pure Partner Tier logic: per-requirement gap (delta) computation, plan
 * achievement, and the 30/60/90-day advancement plan. No database, no clock —
 * deterministic and unit-testable.
 */

export interface RequirementValue {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly threshold: number;
  readonly currentValue: number;
}

export interface Gap {
  /** Remaining amount to reach the threshold (0 if met). */
  readonly delta: number;
  readonly met: boolean;
  /** Progress 0–100. */
  readonly progress: number;
}

export function gapFor(req: RequirementValue): Gap {
  const met = req.currentValue >= req.threshold;
  const delta = met ? 0 : req.threshold - req.currentValue;
  const progress =
    req.threshold <= 0
      ? 100
      : Math.min(100, Math.round((req.currentValue / req.threshold) * 100));
  return { delta, met, progress };
}

export interface PlanSummary {
  readonly met: number;
  readonly total: number;
  /** Percent of requirements fully met. */
  readonly percent: number;
}

export function planSummary(reqs: readonly RequirementValue[]): PlanSummary {
  const total = reqs.length;
  const met = reqs.filter((r) => gapFor(r).met).length;
  const percent = total === 0 ? 0 : Math.round((met / total) * 100);
  return { met, total, percent };
}

/** A plan is achievable once every requirement is met. */
export function isAchievable(reqs: readonly RequirementValue[]): boolean {
  return reqs.length > 0 && reqs.every((r) => gapFor(r).met);
}

/** Can a tenant target `target` from `current`? Only strictly upward. */
export function canAdvance(current: TierId, target: TierId): boolean {
  return TIER_ORDER.indexOf(target) > TIER_ORDER.indexOf(current);
}

export type Phase = 30 | 60 | 90;

/**
 * Phase for an unmet requirement: the closer to the threshold, the sooner. This
 * is data-driven off progress, so the plan reflects real remaining effort.
 */
export function phaseFor(req: RequirementValue): Phase {
  const { progress } = gapFor(req);
  if (progress >= 70) return 30;
  if (progress >= 40) return 60;
  return 90;
}

export interface AdvancementPlan {
  readonly phase30: readonly RequirementValue[];
  readonly phase60: readonly RequirementValue[];
  readonly phase90: readonly RequirementValue[];
}

/** Bucket the unmet requirements into 30/60/90-day phases, sorted by key. */
export function advancementPlan(
  reqs: readonly RequirementValue[],
): AdvancementPlan {
  const unmet = reqs.filter((r) => !gapFor(r).met);
  const byPhase = (p: Phase) =>
    unmet
      .filter((r) => phaseFor(r) === p)
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key));
  return { phase30: byPhase(30), phase60: byPhase(60), phase90: byPhase(90) };
}

export interface CoverageItem {
  readonly met: boolean;
  readonly hasTask: boolean;
  readonly hasEvidence: boolean;
}

export interface Coverage {
  readonly total: number;
  readonly met: number;
  /** Unmet requirements (the open gaps). */
  readonly open: number;
  /** Open gaps that have a task. */
  readonly withTask: number;
  /** Open gaps that have evidence staged. */
  readonly withEvidence: number;
  /** Open gaps with a task OR evidence — i.e. work is underway. */
  readonly actioned: number;
}

/**
 * How much of the remaining work is already actioned: of the open gaps, how many
 * have a task and/or evidence attached. Surfaces "what still needs an owner".
 */
export function coverage(items: readonly CoverageItem[]): Coverage {
  const open = items.filter((i) => !i.met);
  return {
    total: items.length,
    met: items.length - open.length,
    open: open.length,
    withTask: open.filter((i) => i.hasTask).length,
    withEvidence: open.filter((i) => i.hasEvidence).length,
    actioned: open.filter((i) => i.hasTask || i.hasEvidence).length,
  };
}
