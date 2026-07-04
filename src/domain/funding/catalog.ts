import type { TierId } from "@/domain/tiers/catalog";
import type { OpportunityStage, OpportunitySource } from "@/domain/ace/opportunities";

/**
 * The static, source-backed AWS Funding catalog: the AWS partner funding programs
 * PartnerOS knows how to surface + match to deals, and their eligibility criteria.
 * Code-versioned (not tenant data), like the Program Library + Tier catalog, so it
 * ships with the deployment and is trivially unit-testable.
 *
 * NOTE: this is a best-effort model of the real AWS partner funding programs. Exact
 * caps, co-fund splits, and eligibility change over time — treat the numbers as
 * indicative and verify against the AWS Partner Funding Portal (Partner Central)
 * before submitting. `capUsd` is an indicative maximum, not a guarantee.
 */

export type FundingCategory =
  | "migration"
  | "poc"
  | "marketing"
  | "investment"
  | "assessment"
  | "workload"
  | "incentive";

export type FundingType = "cash" | "credits" | "both";

export type WorkloadType =
  | "migration"
  | "net_new"
  | "modernization"
  | "analytics"
  | "ai_ml"
  | "windows"
  | "sap"
  | "vmware"
  | "other";

export type CustomerSegment = "enterprise" | "mid_market" | "smb" | "startup" | "public_sector";

/** A machine-checkable eligibility rule; each carries a human `label` for the UI. */
export type EligibilityCriterion =
  | { readonly kind: "min_tier"; readonly tier: TierId; readonly label: string }
  | { readonly kind: "competency_required"; readonly label: string }
  | { readonly kind: "deal_stage"; readonly minStage: OpportunityStage; readonly label: string }
  | { readonly kind: "min_deal_size"; readonly amountUsd: number; readonly label: string }
  | { readonly kind: "workload_type"; readonly workloads: readonly WorkloadType[]; readonly label: string }
  | { readonly kind: "customer_segment"; readonly segments: readonly CustomerSegment[]; readonly label: string }
  | { readonly kind: "source"; readonly sources: readonly OpportunitySource[]; readonly label: string }
  | { readonly kind: "note"; readonly label: string };

export interface FundingProgram {
  readonly key: string;
  readonly name: string;
  readonly category: FundingCategory;
  readonly fundingType: FundingType;
  readonly description: string;
  /** Indicative maximum funding (USD); null when it is deal-scoped / unbounded. */
  readonly capUsd: number | null;
  readonly coFundNote: string;
  readonly eligibility: readonly EligibilityCriterion[];
  readonly phases: readonly string[];
  readonly typicalTimelineDays: number;
  readonly applyUrl: string;
  /** When set, applications are handled in a dedicated internal section (MDF). */
  readonly managedInternally?: "mdf";
}

export const FUNDING_CATEGORY_LABELS: Record<FundingCategory, string> = {
  migration: "Migration",
  poc: "Proof of Concept",
  marketing: "Marketing",
  investment: "Investment",
  assessment: "Assessment",
  workload: "Workload",
  incentive: "Incentive",
};

export const FUNDING_TYPE_LABELS: Record<FundingType, string> = {
  cash: "Cash",
  credits: "AWS credits",
  both: "Cash + credits",
};

export const WORKLOAD_LABELS: Record<WorkloadType, string> = {
  migration: "Migration",
  net_new: "Net-new build",
  modernization: "Modernization",
  analytics: "Analytics / data",
  ai_ml: "AI / ML",
  windows: "Windows / SQL",
  sap: "SAP",
  vmware: "VMware",
  other: "Other",
};

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  enterprise: "Enterprise",
  mid_market: "Mid-market",
  smb: "SMB",
  startup: "Startup",
  public_sector: "Public sector",
};

const PORTAL = "https://aws.amazon.com/partners/funding/";

export const FUNDING_PROGRAMS: readonly FundingProgram[] = [
  {
    key: "map",
    name: "Migration Acceleration Program (MAP)",
    category: "migration",
    fundingType: "both",
    description:
      "AWS's flagship migration program — funded Assess, Mobilize, and Migrate & Modernize phases with cash incentives plus AWS credits tied to migrated/modernized ARR.",
    capUsd: 500_000,
    coFundNote: "Incentives scale with migrated Annual Recurring Revenue; credits offset migration run-cost.",
    eligibility: [
      { kind: "min_tier", tier: "select", label: "Select tier or above" },
      { kind: "competency_required", label: "AWS Migration Competency (or MAP-ready) recommended" },
      { kind: "deal_stage", minStage: "business_validation", label: "Deal at Business Validation or later" },
      { kind: "workload_type", workloads: ["migration", "modernization"], label: "Migration or modernization workload" },
      { kind: "min_deal_size", amountUsd: 100_000, label: "Target ARR/deal ≥ $100k" },
    ],
    phases: ["Assess", "Mobilize", "Migrate & Modernize"],
    typicalTimelineDays: 30,
    applyUrl: PORTAL,
  },
  {
    key: "poc_funding",
    name: "Proof of Concept (PoC) Funding",
    category: "poc",
    fundingType: "credits",
    description:
      "AWS credits to fund a customer proof of concept, de-risking a technical trial before commitment. Typically requested via your AWS PDM/seller on a live opportunity.",
    capUsd: 50_000,
    coFundNote: "Credits cover PoC infrastructure run-cost; requires a defined success criteria + close plan.",
    eligibility: [
      { kind: "deal_stage", minStage: "qualified", label: "Qualified opportunity with a defined PoC" },
      { kind: "min_deal_size", amountUsd: 25_000, label: "Expected deal ≥ $25k" },
      { kind: "source", sources: ["amazon_originated", "partner_originated"], label: "AWS-registered opportunity" },
    ],
    phases: ["Scope", "Approve", "Execute", "Report"],
    typicalTimelineDays: 21,
    applyUrl: PORTAL,
  },
  {
    key: "mdf",
    name: "Market Development Funds (MDF)",
    category: "marketing",
    fundingType: "cash",
    description:
      "Co-funds demand-generation and joint marketing (events, campaigns, content). Managed end-to-end in the MDF section, with the AWS activity catalog, compliance checks, and claim tracking.",
    capUsd: 50_000,
    coFundNote: "Typically 50% AWS co-fund on approved activities; proof of performance required to claim.",
    eligibility: [
      { kind: "min_tier", tier: "select", label: "Select tier or above" },
      { kind: "note", label: "Approved marketing activity with AWS branding + a linked opportunity" },
    ],
    phases: ["Plan", "Request", "Approve", "Deploy", "Claim", "Reimburse"],
    typicalTimelineDays: 14,
    applyUrl: PORTAL,
    managedInternally: "mdf",
  },
  {
    key: "isv_wmp",
    name: "ISV Workload Migration Program (WMP)",
    category: "workload",
    fundingType: "credits",
    description:
      "For ISVs migrating their software workloads to AWS — assessment funding plus migration credits to accelerate re-platforming onto AWS.",
    capUsd: 100_000,
    coFundNote: "Assessment cash + migration credits; scales with the migrated workload footprint.",
    eligibility: [
      { kind: "min_tier", tier: "select", label: "Select tier or above" },
      { kind: "workload_type", workloads: ["migration", "modernization"], label: "ISV software workload migration" },
      { kind: "note", label: "ISV Path partner with a qualifying software product" },
    ],
    phases: ["Assess", "Mobilize", "Migrate"],
    typicalTimelineDays: 30,
    applyUrl: PORTAL,
  },
  {
    key: "pif",
    name: "Partner Investment Fund (PIF)",
    category: "investment",
    fundingType: "cash",
    description:
      "Strategic co-investment in high-value partner-led opportunities and practice-building initiatives, approved case-by-case with your AWS PDM.",
    capUsd: 250_000,
    coFundNote: "Bespoke co-investment; requires a strong business case + executive sponsorship.",
    eligibility: [
      { kind: "min_tier", tier: "advanced", label: "Advanced tier or above" },
      { kind: "deal_stage", minStage: "business_validation", label: "Committed/validated opportunity" },
      { kind: "min_deal_size", amountUsd: 250_000, label: "Strategic deal ≥ $250k" },
      { kind: "customer_segment", segments: ["enterprise", "public_sector"], label: "Enterprise / public-sector customer" },
    ],
    phases: ["Business case", "PDM review", "Approval", "Deployment"],
    typicalTimelineDays: 45,
    applyUrl: PORTAL,
  },
  {
    key: "sif",
    name: "Strategic Investment Fund (SIF)",
    category: "investment",
    fundingType: "both",
    description:
      "Top-tier strategic investment for transformational, multi-year partner initiatives — highly selective, executive-sponsored.",
    capUsd: 1_000_000,
    coFundNote: "Reserved for transformational bets; blended cash + credits with milestone gating.",
    eligibility: [
      { kind: "min_tier", tier: "premier", label: "Premier tier" },
      { kind: "min_deal_size", amountUsd: 500_000, label: "Transformational program ≥ $500k" },
      { kind: "note", label: "Executive sponsorship + multi-year commitment" },
    ],
    phases: ["Concept", "Diligence", "Approval", "Milestones"],
    typicalTimelineDays: 60,
    applyUrl: PORTAL,
  },
  {
    key: "wafr",
    name: "Well-Architected Framework Review Funding",
    category: "assessment",
    fundingType: "credits",
    description:
      "AWS credits to fund customer Well-Architected Framework Reviews delivered by a WA Partner Program partner, remediating high-risk issues.",
    capUsd: 5_000,
    coFundNote: "Fixed credit incentive per completed, qualifying WAFR with remediation.",
    eligibility: [
      { kind: "competency_required", label: "Well-Architected Partner Program membership" },
      { kind: "note", label: "Completed review with logged High-Risk Issues (HRIs) + remediation" },
    ],
    phases: ["Schedule", "Review", "Remediate", "Claim"],
    typicalTimelineDays: 21,
    applyUrl: PORTAL,
  },
  {
    key: "ola",
    name: "Optimization and Licensing Assessment (OLA)",
    category: "assessment",
    fundingType: "credits",
    description:
      "Funded assessment of a customer's on-premises/cloud estate to right-size and optimize licensing (esp. Windows/SQL), producing a migration business case.",
    capUsd: 15_000,
    coFundNote: "Assessment-funded; strongest when it feeds a downstream migration.",
    eligibility: [
      { kind: "workload_type", workloads: ["migration", "windows"], label: "Migration / Windows-SQL estate" },
      { kind: "deal_stage", minStage: "qualified", label: "Qualified assessment opportunity" },
    ],
    phases: ["Data collection", "Analysis", "Business case"],
    typicalTimelineDays: 30,
    applyUrl: PORTAL,
  },
  {
    key: "windows_migration",
    name: "Windows & SQL Server Migration Incentive",
    category: "workload",
    fundingType: "both",
    description:
      "Incentives + credits for migrating Windows and SQL Server workloads to AWS, including modernization off legacy licensing.",
    capUsd: 100_000,
    coFundNote: "Workload-specific incentive; often paired with OLA + MAP.",
    eligibility: [
      { kind: "min_tier", tier: "select", label: "Select tier or above" },
      { kind: "workload_type", workloads: ["windows", "migration"], label: "Windows / SQL Server workload" },
    ],
    phases: ["Assess", "Migrate", "Modernize"],
    typicalTimelineDays: 30,
    applyUrl: PORTAL,
  },
  {
    key: "vmware_migration",
    name: "VMware Migration Accelerator",
    category: "workload",
    fundingType: "both",
    description:
      "Funding to accelerate migrations of VMware workloads to AWS (native or VMware Cloud on AWS), covering assessment and migration.",
    capUsd: 100_000,
    coFundNote: "Workload-specific; assessment cash + migration credits.",
    eligibility: [
      { kind: "min_tier", tier: "select", label: "Select tier or above" },
      { kind: "workload_type", workloads: ["vmware", "migration"], label: "VMware workload migration" },
    ],
    phases: ["Assess", "Migrate"],
    typicalTimelineDays: 30,
    applyUrl: PORTAL,
  },
  {
    key: "sap_migration",
    name: "SAP on AWS Migration Funding",
    category: "workload",
    fundingType: "both",
    description:
      "Incentives + credits for migrating and running SAP workloads on AWS, from assessment through go-live, for SAP-competency partners.",
    capUsd: 250_000,
    coFundNote: "SAP-specific; scales with SAP workload size and complexity.",
    eligibility: [
      { kind: "min_tier", tier: "advanced", label: "Advanced tier or above" },
      { kind: "competency_required", label: "AWS SAP Competency recommended" },
      { kind: "workload_type", workloads: ["sap", "migration"], label: "SAP workload" },
    ],
    phases: ["Assess", "Mobilize", "Migrate", "Operate"],
    typicalTimelineDays: 45,
    applyUrl: PORTAL,
  },
  {
    key: "sales_acceleration",
    name: "Sales / Business Development Funding",
    category: "incentive",
    fundingType: "cash",
    description:
      "Discretionary funding to accelerate co-sell pipeline — dedicated BD headcount, sales plays, and enablement, approved with your AWS PDM.",
    capUsd: 75_000,
    coFundNote: "Pipeline-linked; requires committed co-sell targets + reporting.",
    eligibility: [
      { kind: "min_tier", tier: "advanced", label: "Advanced tier or above" },
      { kind: "source", sources: ["amazon_originated"], label: "Active AWS co-sell relationship" },
      { kind: "note", label: "Committed co-sell pipeline targets" },
    ],
    phases: ["Plan", "PDM approval", "Execute", "Report"],
    typicalTimelineDays: 30,
    applyUrl: PORTAL,
  },
];

const BY_KEY: ReadonlyMap<string, FundingProgram> = new Map(FUNDING_PROGRAMS.map((p) => [p.key, p]));

export function getFundingProgram(key: string): FundingProgram | undefined {
  return BY_KEY.get(key);
}
