/**
 * Static, code-versioned AWS partner-tier thresholds: the official requirement
 * references a partner must meet to reach each tier. Code (not tenant data), so
 * it ships with the deployment and is unit-testable. CATALOG_VERSION is stamped
 * on a plan at creation so its requirements stay reproducible across revisions.
 */

export const CATALOG_VERSION = 1;

export type TierId = "registered" | "select" | "advanced" | "premier";

/** Tiers in ascending order; advancement only moves up this list. */
export const TIER_ORDER: readonly TierId[] = [
  "registered",
  "select",
  "advanced",
  "premier",
];

export const TIER_LABELS: Record<TierId, string> = {
  registered: "Registered",
  select: "Select",
  advanced: "Advanced",
  premier: "Premier",
};

export interface ThresholdRequirement {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly unit: string;
  readonly threshold: number;
}

/**
 * Requirements to REACH each target tier. 'registered' is the entry tier and has
 * no thresholds, so it is not a valid advancement target.
 */
export const TIER_THRESHOLDS: Record<
  Exclude<TierId, "registered">,
  readonly ThresholdRequirement[]
> = {
  select: [
    { key: "launched_opportunities", label: "Launched opportunities", category: "opportunities", unit: "opps", threshold: 1 },
    { key: "aws_certifications", label: "AWS certifications", category: "certifications", unit: "certs", threshold: 2 },
    { key: "customer_references", label: "Customer references", category: "references", unit: "refs", threshold: 1 },
  ],
  advanced: [
    { key: "launched_opportunities", label: "Launched opportunities", category: "opportunities", unit: "opps", threshold: 10 },
    { key: "aws_certifications", label: "AWS certifications", category: "certifications", unit: "certs", threshold: 8 },
    { key: "customer_references", label: "Customer references", category: "references", unit: "refs", threshold: 3 },
    { key: "technical_validations", label: "Technical validations", category: "validations", unit: "validations", threshold: 1 },
  ],
  premier: [
    { key: "launched_opportunities", label: "Launched opportunities", category: "opportunities", unit: "opps", threshold: 50 },
    { key: "aws_certifications", label: "AWS certifications", category: "certifications", unit: "certs", threshold: 25 },
    { key: "customer_references", label: "Customer references", category: "references", unit: "refs", threshold: 10 },
    { key: "technical_validations", label: "Technical validations", category: "validations", unit: "validations", threshold: 3 },
    { key: "competencies", label: "Competencies or specializations", category: "competencies", unit: "competencies", threshold: 1 },
  ],
};

export function thresholdsForTier(target: TierId): readonly ThresholdRequirement[] {
  if (target === "registered") return [];
  return TIER_THRESHOLDS[target];
}

/** Target tiers strictly above `current`, in ascending order. */
export function tiersAbove(current: TierId): TierId[] {
  const idx = TIER_ORDER.indexOf(current);
  return TIER_ORDER.slice(idx + 1).filter((t) => t !== "registered");
}
