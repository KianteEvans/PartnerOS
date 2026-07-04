/**
 * Static, code-versioned AWS Consulting Partner tier criteria: the official
 * requirements a partner must meet to reach each tier. Code (not tenant data), so
 * it ships with the deployment and is unit-testable. CATALOG_VERSION is stamped
 * on a plan at creation so its requirements stay reproducible across revisions.
 *
 * v2 models the real AWS criteria, which go beyond a single numeric threshold:
 *   - `kind: "boolean"`   — a yes/no requirement (Business Plan, Exec Review, …).
 *   - `secondary`         — a 2nd numeric gate alongside the count (e.g. launched
 *                           opportunities also need a Total MRR; technical certs
 *                           need a Professional/Specialty sub-minimum).
 *   - `note`              — a human constraint shown alongside ("Must include …").
 *   - `informational`     — context shown but NOT gating advancement (the fee).
 *   - `derive`            — the value is auto-measured from existing platform data.
 */

export const CATALOG_VERSION = 2;

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

export type RequirementKind = "count" | "boolean";

/** A second numeric gate that must ALSO be met (e.g. MRR alongside opp count). */
export interface RequirementConstraint {
  readonly label: string;
  readonly unit: string;
  readonly threshold: number;
}

/** Which platform measurement auto-fills this requirement's current value. */
export type DeriveSource = "launched_count" | "competency_count" | "sustained";

export interface ThresholdRequirement {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly unit: string;
  readonly threshold: number;
  /** Defaults to "count". A "boolean" requirement is met at currentValue >= 1. */
  readonly kind?: RequirementKind;
  /** An additional numeric gate that must also be satisfied. */
  readonly secondary?: RequirementConstraint;
  /** A human constraint shown with the requirement (not machine-enforced). */
  readonly note?: string;
  /** Context only — shown but excluded from the advancement gate + progress. */
  readonly informational?: boolean;
  /** Auto-measured from platform data via the "Sync measured values" action. */
  readonly derive?: DeriveSource;
}

/** The annual APN fee — identical across tiers, shown as context (not a gate). */
const ANNUAL_FEE: ThresholdRequirement = {
  key: "annual_apn_fee",
  label: "Annual APN fee",
  category: "fee",
  unit: "$/yr",
  threshold: 2500,
  informational: true,
};

/**
 * Requirements to REACH each target tier (the full set, not deltas). 'registered'
 * is the entry tier and has no thresholds, so it is not a valid advancement target.
 */
export const TIER_THRESHOLDS: Record<
  Exclude<TierId, "registered">,
  readonly ThresholdRequirement[]
> = {
  select: [
    ANNUAL_FEE,
    { key: "accredited_technical", label: "Accredited individuals - Technical", category: "accreditation", unit: "people", threshold: 2 },
    { key: "accredited_business", label: "Accredited individuals - Business", category: "accreditation", unit: "people", threshold: 2 },
    { key: "foundational_certs", label: "AWS Foundational certified individuals", category: "certifications", unit: "people", threshold: 2 },
    { key: "technical_certs", label: "AWS Technical certified individuals", category: "certifications", unit: "people", threshold: 2 },
    {
      key: "launched_opportunities",
      label: "Launched opportunities",
      category: "opportunities",
      unit: "opps",
      threshold: 3,
      secondary: { label: "Total MRR", unit: "$", threshold: 1500 },
      derive: "launched_count",
    },
  ],
  advanced: [
    ANNUAL_FEE,
    { key: "accredited_technical", label: "Accredited individuals - Technical", category: "accreditation", unit: "people", threshold: 4 },
    { key: "accredited_business", label: "Accredited individuals - Business", category: "accreditation", unit: "people", threshold: 4 },
    { key: "foundational_certs", label: "AWS Foundational certified individuals", category: "certifications", unit: "people", threshold: 4 },
    {
      key: "technical_certs",
      label: "AWS Technical certified individuals",
      category: "certifications",
      unit: "people",
      threshold: 6,
      secondary: { label: "Professional/Specialty", unit: "certs", threshold: 3 },
    },
    {
      key: "launched_opportunities",
      label: "Launched opportunities",
      category: "opportunities",
      unit: "opps",
      threshold: 20,
      secondary: { label: "Total MRR", unit: "$", threshold: 10_000 },
      derive: "launched_count",
    },
    { key: "partner_business_plan", label: "Partner Business Plan", category: "governance", unit: "", threshold: 1, kind: "boolean" },
  ],
  premier: [
    ANNUAL_FEE,
    { key: "accredited_technical", label: "Accredited individuals - Technical", category: "accreditation", unit: "people", threshold: 10 },
    { key: "accredited_business", label: "Accredited individuals - Business", category: "accreditation", unit: "people", threshold: 10 },
    { key: "foundational_certs", label: "AWS Foundational certified individuals", category: "certifications", unit: "people", threshold: 10 },
    {
      key: "technical_certs",
      label: "AWS Technical certified individuals",
      category: "certifications",
      unit: "people",
      threshold: 25,
      secondary: { label: "Professional/Specialty", unit: "certs", threshold: 10 },
    },
    {
      key: "launched_opportunities",
      label: "Launched opportunities",
      category: "opportunities",
      unit: "opps",
      threshold: 50,
      secondary: { label: "Total MRR", unit: "$", threshold: 50_000 },
      derive: "launched_count",
    },
    { key: "partner_business_plan", label: "Partner Business Plan", category: "governance", unit: "", threshold: 1, kind: "boolean" },
    { key: "executive_business_review", label: "Executive Business Review", category: "governance", unit: "", threshold: 1, kind: "boolean" },
    {
      key: "competencies",
      label: "AWS Competency, MSP, or Well-Architected",
      category: "competencies",
      unit: "programs",
      threshold: 3,
      note: "Must include MSP, DevOps, or CloudOps Competency",
      derive: "competency_count",
    },
    {
      key: "sustained_attainment",
      label: "Sustained tier criteria (6+ months)",
      category: "tenure",
      unit: "",
      threshold: 1,
      kind: "boolean",
      derive: "sustained",
    },
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
