/**
 * The Readiness Assessment question catalog. This is STATIC, code-versioned
 * content (not tenant data), so it lives in code rather than the database: it
 * needs no RLS, ships with the deployment, and is trivially unit-testable.
 *
 * `CATALOG_VERSION` is stamped onto each assessment at create time
 * (assessments.catalog_version) so a scored assessment stays reproducible even
 * after this catalog is revised. Bump it whenever questions, options, weights,
 * or scores change in a way that would alter scoring.
 */

export const CATALOG_VERSION = 1;

export type ModuleId =
  | "gtm"
  | "competency"
  | "specialization"
  | "partner_tier"
  | "marketplace"
  | "mdf"
  | "evidence";

export type PresetId =
  | "program_submission"
  | "growth_funding"
  | "tier_advancement"
  | "custom";

export interface QuestionOption {
  /** Stored verbatim in assessment_responses.value. */
  readonly value: string;
  readonly label: string;
  /** Contribution to the module score, 0–100. */
  readonly score: number;
}

export interface AssessmentQuestion {
  /** Globally unique, module-namespaced (e.g. "gtm.exec_sponsor"). */
  readonly key: string;
  readonly module: ModuleId;
  readonly prompt: string;
  /** Relative weight within its module. */
  readonly weight: number;
  readonly options: readonly QuestionOption[];
}

export const MODULE_LABELS: Record<ModuleId, string> = {
  gtm: "GTM Readiness",
  competency: "Competency Readiness",
  specialization: "Specialization Readiness",
  partner_tier: "Partner Tier Readiness",
  marketplace: "Marketplace Readiness",
  mdf: "MDF Readiness",
  evidence: "Evidence Readiness",
};

export const PRESET_LABELS: Record<PresetId, string> = {
  program_submission: "Program Submission Readiness",
  growth_funding: "Growth & Funding Readiness",
  tier_advancement: "Tier Advancement Readiness",
  custom: "Custom Assessment",
};

export const ALL_MODULES: readonly ModuleId[] = [
  "gtm",
  "competency",
  "specialization",
  "partner_tier",
  "marketplace",
  "mdf",
  "evidence",
];

/** Which modules each preset evaluates. `custom` covers all of them. */
export const PRESET_MODULES: Record<PresetId, readonly ModuleId[]> = {
  program_submission: ["gtm", "competency", "evidence"],
  growth_funding: ["gtm", "mdf", "marketplace"],
  tier_advancement: ["partner_tier", "competency", "specialization"],
  custom: ALL_MODULES,
};

/** A reusable 4-level maturity scale: none → partial → established → optimized. */
function maturityScale(): readonly QuestionOption[] {
  return [
    { value: "none", label: "Not started", score: 0 },
    { value: "partial", label: "In progress", score: 40 },
    { value: "established", label: "Established", score: 70 },
    { value: "optimized", label: "Optimized", score: 100 },
  ];
}

/** A simple yes / partial / no scale. */
function yesPartialNo(): readonly QuestionOption[] {
  return [
    { value: "no", label: "No", score: 0 },
    { value: "partial", label: "Partially", score: 50 },
    { value: "yes", label: "Yes", score: 100 },
  ];
}

export const QUESTIONS: readonly AssessmentQuestion[] = [
  // GTM
  {
    key: "gtm.exec_sponsor",
    module: "gtm",
    prompt: "Is there a named executive sponsor for the AWS partnership?",
    weight: 1,
    options: yesPartialNo(),
  },
  {
    key: "gtm.joint_plan",
    module: "gtm",
    prompt: "Maturity of the joint AWS go-to-market plan.",
    weight: 2,
    options: maturityScale(),
  },
  {
    key: "gtm.pipeline",
    module: "gtm",
    prompt: "Maturity of co-sell pipeline generation with AWS.",
    weight: 2,
    options: maturityScale(),
  },
  // Competency
  {
    key: "competency.case_studies",
    module: "competency",
    prompt: "Number of qualifying public customer case studies.",
    weight: 2,
    options: [
      { value: "0", label: "None", score: 0 },
      { value: "1", label: "1", score: 50 },
      { value: "2", label: "2", score: 80 },
      { value: "3plus", label: "3 or more", score: 100 },
    ],
  },
  {
    key: "competency.tech_validation",
    module: "competency",
    prompt: "Status of technical/architecture validation readiness.",
    weight: 2,
    options: maturityScale(),
  },
  {
    key: "competency.certified_staff",
    module: "competency",
    prompt: "Do you meet the certified-staff headcount for the competency?",
    weight: 1,
    options: yesPartialNo(),
  },
  // Specialization
  {
    key: "specialization.use_case",
    module: "specialization",
    prompt: "Clarity of the targeted specialization use case.",
    weight: 2,
    options: maturityScale(),
  },
  {
    key: "specialization.references",
    module: "specialization",
    prompt: "Do you have specialization-specific customer references?",
    weight: 1,
    options: yesPartialNo(),
  },
  {
    key: "specialization.delivery",
    module: "specialization",
    prompt: "Maturity of a repeatable delivery methodology.",
    weight: 1,
    options: maturityScale(),
  },
  // Partner Tier
  {
    key: "partner_tier.launched_opps",
    module: "partner_tier",
    prompt: "Launched opportunities against the target-tier threshold.",
    weight: 2,
    options: [
      { value: "below", label: "Below threshold", score: 0 },
      { value: "near", label: "Near threshold", score: 60 },
      { value: "met", label: "Met or exceeded", score: 100 },
    ],
  },
  {
    key: "partner_tier.certifications",
    module: "partner_tier",
    prompt: "Certification count against the target-tier requirement.",
    weight: 2,
    options: [
      { value: "below", label: "Below requirement", score: 0 },
      { value: "near", label: "Near requirement", score: 60 },
      { value: "met", label: "Met or exceeded", score: 100 },
    ],
  },
  {
    key: "partner_tier.cert_renewal",
    module: "partner_tier",
    prompt: "Are any required certifications expiring within 90 days?",
    weight: 1,
    options: [
      { value: "many", label: "Several expiring", score: 0 },
      { value: "some", label: "A few expiring", score: 50 },
      { value: "none", label: "None expiring", score: 100 },
    ],
  },
  // Marketplace
  {
    key: "marketplace.listing",
    module: "marketplace",
    prompt: "Maturity of your AWS Marketplace listing.",
    weight: 2,
    options: maturityScale(),
  },
  {
    key: "marketplace.private_offers",
    module: "marketplace",
    prompt: "Do you use private offers / contracts in Marketplace?",
    weight: 1,
    options: yesPartialNo(),
  },
  {
    key: "marketplace.metering",
    module: "marketplace",
    prompt: "Maturity of metering / billing integration.",
    weight: 1,
    options: maturityScale(),
  },
  // MDF
  {
    key: "mdf.plan",
    module: "mdf",
    prompt: "Maturity of the MDF plan tied to GTM activities.",
    weight: 2,
    options: maturityScale(),
  },
  {
    key: "mdf.proof_process",
    module: "mdf",
    prompt: "Do you have a process to collect MDF proof-of-performance?",
    weight: 2,
    options: yesPartialNo(),
  },
  {
    key: "mdf.utilization",
    module: "mdf",
    prompt: "Historical MDF utilization rate.",
    weight: 1,
    options: [
      { value: "low", label: "Under 40%", score: 20 },
      { value: "mid", label: "40–75%", score: 60 },
      { value: "high", label: "Over 75%", score: 100 },
    ],
  },
  // Evidence
  {
    key: "evidence.coverage",
    module: "evidence",
    prompt: "Coverage of required evidence across target programs.",
    weight: 2,
    options: maturityScale(),
  },
  {
    key: "evidence.freshness",
    module: "evidence",
    prompt: "Are stored evidence artifacts current (not expired)?",
    weight: 1,
    options: yesPartialNo(),
  },
  {
    key: "evidence.organization",
    module: "evidence",
    prompt: "Maturity of evidence organization and ownership.",
    weight: 1,
    options: maturityScale(),
  },
];

/** Questions for a single module, in catalog order. */
export function questionsForModule(
  module: ModuleId,
): readonly AssessmentQuestion[] {
  return QUESTIONS.filter((q) => q.module === module);
}

/** Questions for an assessment's in-scope modules, in catalog order. */
export function questionsForModules(
  modules: readonly ModuleId[],
): readonly AssessmentQuestion[] {
  const scope = new Set(modules);
  return QUESTIONS.filter((q) => scope.has(q.module));
}

const QUESTION_BY_KEY: ReadonlyMap<string, AssessmentQuestion> = new Map(
  QUESTIONS.map((q) => [q.key, q]),
);

export function getQuestion(key: string): AssessmentQuestion | undefined {
  return QUESTION_BY_KEY.get(key);
}
