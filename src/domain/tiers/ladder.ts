import {
  TIER_ORDER,
  TIER_LABELS,
  thresholdsForTier,
  type TierId,
} from "@/domain/tiers/catalog";

/**
 * Pure tier-ladder model for the Advance stepper: where the workspace sits on the
 * registered -> select -> advanced -> premier path, and where it's heading. No DB,
 * no clock. `reqCount` is how many GATING requirements a tier asks for (drives the
 * chip) — informational entries like the annual fee are context, not counted, so it
 * agrees with planSummary's met/total.
 */
export type LadderStatus = "achieved" | "current" | "upcoming" | "target" | "locked";

export interface LadderStep {
  readonly tier: TierId;
  readonly label: string;
  readonly reqCount: number;
  readonly status: LadderStatus;
}

export function tierLadder(current: TierId, target?: TierId): LadderStep[] {
  const ci = TIER_ORDER.indexOf(current);
  const ti = target ? TIER_ORDER.indexOf(target) : -1;
  return TIER_ORDER.map((tier, i) => {
    let status: LadderStatus;
    if (i < ci) status = "achieved";
    else if (i === ci) status = "current";
    else if (ti > ci && i === ti) status = "target";
    else if (ti > ci && i < ti) status = "upcoming";
    else status = "locked";
    return {
      tier,
      label: TIER_LABELS[tier],
      reqCount: thresholdsForTier(tier).filter((t) => !t.informational).length,
      status,
    };
  });
}
