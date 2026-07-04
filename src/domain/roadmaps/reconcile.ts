/**
 * Pure live roadmap reconciliation: which composed milestones are objectively satisfied
 * by the real underlying state and should auto-advance to "done". Forward-only — it never
 * touches milestones that are already done or blocked, never advances a `custom` milestone
 * (no catalog origin to check), and never un-does. Program milestones match on the program
 * library key; tier milestones on the "<tier>:<requirementKey>" origin ref. No DB, no clock.
 */

export interface ReconcileMilestone {
  readonly id: string;
  readonly title: string;
  /** "program" | "tier" | "custom". */
  readonly originKind: string;
  /** Program library key, or "<tier>:<requirementKey>". */
  readonly originRef: string;
  /** "planned" | "in_progress" | "done" | "blocked". */
  readonly status: string;
}

export interface MilestoneRealState {
  /** Program library keys currently `active` in the tenant. */
  readonly activeProgramKeys: ReadonlySet<string>;
  /** Tier requirement keys ("<tier>:<requirementKey>") whose threshold is met. */
  readonly metTierReqKeys: ReadonlySet<string>;
}

export interface MilestoneAdvance {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

export interface ReconcileResult {
  readonly toAdvance: readonly MilestoneAdvance[];
}

export function reconcileMilestones(
  milestones: readonly ReconcileMilestone[],
  realState: MilestoneRealState,
): ReconcileResult {
  const toAdvance: MilestoneAdvance[] = [];
  for (const m of milestones) {
    // Forward-only: leave finished/blocked milestones and manual (custom) ones alone.
    if (m.status === "done" || m.status === "blocked") continue;
    if (m.originKind === "program" && realState.activeProgramKeys.has(m.originRef)) {
      toAdvance.push({ id: m.id, title: m.title, reason: "Program active" });
    } else if (m.originKind === "tier" && realState.metTierReqKeys.has(m.originRef)) {
      toAdvance.push({ id: m.id, title: m.title, reason: "Requirement met" });
    }
  }
  return { toAdvance };
}
