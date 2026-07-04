import { TIER_ORDER, type TierId, type ThresholdRequirement } from "@/domain/tiers/catalog";

/**
 * Pure tier-readiness grounding for a roadmap. No database, no clock. Given a
 * roadmap's milestones, works out which AWS partner tier the roadmap targets
 * (implicit in its tier-origin milestones) and how completely those milestones
 * cover that tier's threshold requirements — so the detail page can say "this
 * roadmap closes N of M requirements for Advanced" instead of just showing a
 * task list. Deterministic and unit-testable; degrades to null when the roadmap
 * has no tier target.
 *
 * Coverage is about whether each tier requirement HAS a milestone and how far it
 * has progressed — distinct from the tenant's real AWS values (those are rolled
 * onto finalized milestones separately on the detail page).
 */

export type CoverageState = "covered" | "in_progress" | "planned" | "uncovered";

export interface CoverageMilestoneInput {
  /** "custom" | "assessment" | "program" | "tier". */
  readonly originKind: string;
  /** Tier rows carry "<tier>:<requirementKey>" (e.g. "advanced:technical_certs"). */
  readonly originRef: string;
  readonly status: "planned" | "in_progress" | "done" | "blocked";
  /** ISO target date (YYYY-MM-DD). */
  readonly targetDate: string;
}

export interface RequirementCoverage {
  readonly key: string;
  readonly label: string;
  readonly state: CoverageState;
  /** Target date of the covering milestone, or null when uncovered. */
  readonly targetDate: string | null;
}

export interface CoverageSummary {
  readonly tier: TierId;
  readonly total: number;
  /** Requirements whose milestone is done. */
  readonly covered: number;
  /** Requirements that have a milestone in any state. */
  readonly withMilestone: number;
  /** Requirements with no milestone at all. */
  readonly uncovered: number;
  /** covered / total, 0-100. */
  readonly percent: number;
  readonly requirements: readonly RequirementCoverage[];
  readonly uncoveredRequirements: readonly RequirementCoverage[];
  /** Latest target date among the tier milestones (NOT a velocity forecast). */
  readonly projectedReadyDate: string | null;
  readonly projectedComplete: boolean;
}

/**
 * The tier this roadmap targets: the HIGHEST tier referenced by any tier-origin
 * milestone (a roadmap that mixes Select + Advanced goals is targeting Advanced).
 * Null when no tier-origin milestones are present.
 */
export function targetTierFromMilestones(
  milestones: readonly CoverageMilestoneInput[],
): TierId | null {
  let best: TierId | null = null;
  let bestIdx = -1;
  for (const m of milestones) {
    if (m.originKind !== "tier") continue;
    const token = m.originRef.split(":")[0] ?? "";
    const idx = TIER_ORDER.indexOf(token as TierId);
    if (idx < 0) continue; // malformed / unknown tier token
    if (idx > bestIdx) {
      bestIdx = idx;
      best = token as TierId;
    }
  }
  return best;
}

/**
 * Map each of the target tier's threshold requirements to the milestone that
 * advances it (matched by originRef "<tier>:<requirementKey>") and roll up
 * coverage. Returns null when the tier has no thresholds (e.g. "registered").
 */
export function tierCoverage(
  milestones: readonly CoverageMilestoneInput[],
  thresholds: readonly ThresholdRequirement[],
  tier: TierId,
): CoverageSummary | null {
  // Informational requirements (the annual fee) aren't milestones / coverage gaps.
  const gating = thresholds.filter((t) => !t.informational);
  if (gating.length === 0) return null;

  // Index this tier's milestones by requirement key (first match wins).
  const byReqKey = new Map<string, CoverageMilestoneInput>();
  for (const m of milestones) {
    if (m.originKind !== "tier") continue;
    const parts = m.originRef.split(":");
    const [t, key] = parts;
    if (t !== tier || !key) continue;
    if (!byReqKey.has(key)) byReqKey.set(key, m);
  }

  const requirements: RequirementCoverage[] = [];
  let covered = 0;
  let withMilestone = 0;
  let projectedReadyDate: string | null = null;

  for (const req of gating) {
    const m = byReqKey.get(req.key);
    if (!m) {
      requirements.push({ key: req.key, label: req.label, state: "uncovered", targetDate: null });
      continue;
    }
    withMilestone += 1;
    let state: CoverageState;
    if (m.status === "done") {
      state = "covered";
      covered += 1;
    } else if (m.status === "in_progress") {
      state = "in_progress";
    } else {
      state = "planned"; // planned or blocked (blocked isn't progressing)
    }
    if (projectedReadyDate === null || m.targetDate > projectedReadyDate) {
      projectedReadyDate = m.targetDate;
    }
    requirements.push({ key: req.key, label: req.label, state, targetDate: m.targetDate });
  }

  const total = gating.length;
  const uncovered = total - withMilestone;
  const percent = Math.round((covered / total) * 100);
  const uncoveredRequirements = requirements.filter((r) => r.state === "uncovered");
  const projectedComplete = covered === total;

  return {
    tier,
    total,
    covered,
    withMilestone,
    uncovered,
    percent,
    requirements,
    uncoveredRequirements,
    projectedReadyDate,
    projectedComplete,
  };
}
