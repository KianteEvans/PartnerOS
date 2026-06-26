import { TIER_ORDER, TIER_LABELS, type TierId } from "@/domain/tiers/catalog";
import type { ProgramType } from "@/domain/applications/detect";

/**
 * Pure eligibility check for an AWS Specialization application. The AWS
 * Specialization Programs Guide lists prerequisites per program type (partner
 * tier, Path stage, FTR). Tier is checked deterministically against the tenant's
 * current tier; Path stage / FTR / MSP-practice aren't modeled in PartnerOS, so
 * they surface as "confirm" advisories. No DB/clock — unit-tested.
 */

export type PrereqKind = "tier" | "path" | "ftr" | "practice";

export interface Prerequisite {
  readonly kind: PrereqKind;
  readonly label: string;
  /** Minimum tier for kind="tier". */
  readonly minTier?: TierId;
  /** Optional clarifying note (e.g. a Software-Path alternative). */
  readonly note?: string;
}

/** Prerequisites per program type, from the AWS Specialization Programs Guide. */
export const PROGRAM_PREREQUISITES: Record<ProgramType, readonly Prerequisite[]> = {
  Competency: [
    {
      kind: "tier",
      label: "Advanced Tier or higher (Services Path)",
      minTier: "advanced",
      note: "Software-Path partners qualify via an approved FTR instead.",
    },
    { kind: "path", label: "Validated stage of the Services or Software Path" },
  ],
  "Service Delivery": [
    { kind: "tier", label: "Select Tier or higher", minTier: "select" },
    { kind: "path", label: "Validated stage of the Services Path" },
  ],
  "Service Ready": [
    { kind: "path", label: "Validated stage of the Software Path" },
    { kind: "ftr", label: "Approved AWS Foundational Technical Review (FTR) for the Solution" },
  ],
  MSP: [
    { kind: "tier", label: "Advanced Tier or higher", minTier: "advanced" },
    { kind: "path", label: "Validated stage of the Services Path" },
    { kind: "practice", label: "Established AWS MSP practice" },
  ],
  // The FTR is itself the validation — no tier prerequisite.
  FTR: [],
  Unknown: [],
};

export type PrereqState = "met" | "gap" | "confirm";

export interface PrereqStatus {
  readonly kind: PrereqKind;
  readonly label: string;
  readonly state: PrereqState;
  readonly detail: string;
}

export interface EligibilityResult {
  readonly prerequisites: readonly PrereqStatus[];
  /** All tier prerequisites satisfied (deterministic). */
  readonly tierMet: boolean;
  /** A tier prerequisite is provably unmet at the current tier. */
  readonly hasTierGap: boolean;
}

/** Evaluate prerequisites for a program type against the tenant's current tier. */
export function evaluateEligibility(
  programType: ProgramType,
  currentTier: TierId,
): EligibilityResult {
  const reqs = PROGRAM_PREREQUISITES[programType] ?? [];
  const ci = TIER_ORDER.indexOf(currentTier);

  const prerequisites: PrereqStatus[] = reqs.map((p) => {
    if (p.kind === "tier" && p.minTier) {
      const met = ci >= TIER_ORDER.indexOf(p.minTier);
      const base = met
        ? `You are at ${TIER_LABELS[currentTier]} Tier.`
        : `You are at ${TIER_LABELS[currentTier]} Tier — reach ${TIER_LABELS[p.minTier]} Tier.`;
      return {
        kind: p.kind,
        label: p.label,
        state: met ? "met" : "gap",
        detail: p.note ? `${base} ${p.note}` : base,
      };
    }
    return {
      kind: p.kind,
      label: p.label,
      state: "confirm",
      detail: p.note ?? "Not tracked in PartnerOS — confirm this is in place before submitting.",
    };
  });

  const tierItems = prerequisites.filter((p) => p.kind === "tier");
  return {
    prerequisites,
    tierMet: tierItems.every((p) => p.state === "met"),
    hasTierGap: tierItems.some((p) => p.state === "gap"),
  };
}
