import type { PresetId } from "@/domain/assessments/catalog";

/**
 * Static, code-versioned onboarding content and the pure planning logic that
 * turns a chosen path into kickoff work. No database, no I/O — unit-testable.
 */

export type OnboardingStepId =
  | "context"
  | "objectives"
  | "path"
  | "review"
  | "done";

export type PathId = "foundations" | "growth" | "scale";

/** The wizard steps the user actively fills in, in order (excludes 'done'). */
export const WIZARD_STEPS: readonly OnboardingStepId[] = [
  "context",
  "objectives",
  "path",
  "review",
];

export const STEP_LABELS: Record<OnboardingStepId, string> = {
  context: "Company context",
  objectives: "Objectives",
  path: "Guided path",
  review: "Review & unlock",
  done: "Done",
};

export const INDUSTRY_OPTIONS: readonly string[] = [
  "Software / SaaS",
  "Data & Analytics",
  "Security",
  "Financial Services",
  "Healthcare & Life Sciences",
  "Retail & CPG",
  "Public Sector",
  "Other",
];

export const PARTNER_TYPE_OPTIONS: readonly string[] = [
  "ISV / Software",
  "Consulting / SI",
  "Managed Services (MSP)",
  "Reseller / Distributor",
];

export const AWS_STAGE_OPTIONS: readonly string[] = [
  "Exploring",
  "Registered",
  "Select",
  "Advanced",
  "Premier",
];

export const TEAM_SIZE_OPTIONS: readonly string[] = [
  "1–10",
  "11–50",
  "51–200",
  "201–1000",
  "1000+",
];

export interface ObjectiveOption {
  readonly key: string;
  readonly label: string;
}

export const OBJECTIVE_OPTIONS: readonly ObjectiveOption[] = [
  { key: "tier_advancement", label: "Advance our AWS partner tier" },
  { key: "competency", label: "Earn a Competency or Specialization" },
  { key: "cosell", label: "Build co-sell pipeline through ACE" },
  { key: "marketplace", label: "Launch or grow AWS Marketplace" },
  { key: "mdf", label: "Use MDF to fund GTM activities" },
  { key: "evidence", label: "Organize evidence for program submissions" },
];

const OBJECTIVE_KEYS = new Set(OBJECTIVE_OPTIONS.map((o) => o.key));

/** Keep only recognized objective keys, de-duplicated, in catalog order. */
export function normalizeObjectives(keys: readonly string[]): string[] {
  const chosen = new Set(keys.filter((k) => OBJECTIVE_KEYS.has(k)));
  return OBJECTIVE_OPTIONS.filter((o) => chosen.has(o.key)).map((o) => o.key);
}

export interface PathOption {
  readonly key: PathId;
  readonly label: string;
  readonly description: string;
}

export const PATH_OPTIONS: readonly PathOption[] = [
  {
    key: "foundations",
    label: "APN Foundations",
    description:
      "Initial setup, evidence, readiness, program recommendations, and a 90-day plan.",
  },
  {
    key: "growth",
    label: "APN Growth",
    description:
      "Program eligibility, evidence gaps, roadmap development, and MDF checks.",
  },
  {
    key: "scale",
    label: "APN Scale",
    description:
      "ACE execution, seller routing, Marketplace and MDF operations, and reporting.",
  },
];

/** The Readiness Assessment preset seeded for each guided path. */
export function pathToPreset(path: PathId): PresetId {
  switch (path) {
    case "foundations":
      return "program_submission";
    case "growth":
      return "growth_funding";
    case "scale":
      return "tier_advancement";
  }
}

export type Priority = "low" | "medium" | "high" | "critical";

export interface KickoffTask {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
}

/**
 * The initial tasks seeded into Task Manager when onboarding completes. A shared
 * baseline plus a path-specific item. Deterministic for a given path.
 */
export function kickoffTasks(path: PathId): readonly KickoffTask[] {
  const base: KickoffTask[] = [
    {
      key: "profile",
      title: "Complete your workspace profile",
      description: "Confirm company details, owners, and notification settings.",
      priority: "medium",
    },
    {
      key: "assessment",
      title: "Complete your initial readiness assessment",
      description:
        "Answer the seeded assessment so PartnerOS can score readiness and stage recommendations.",
      priority: "high",
    },
    {
      key: "evidence",
      title: "Upload your first customer case study",
      description: "Add a reusable proof artifact for program submissions.",
      priority: "medium",
    },
  ];
  const perPath: Record<PathId, KickoffTask> = {
    foundations: {
      key: "path",
      title: "Identify a target AWS Foundational program",
      description: "Pick the first program to pursue and add it to your roadmap.",
      priority: "high",
    },
    growth: {
      key: "path",
      title: "Review MDF eligibility for a GTM activity",
      description: "Check funding fit before planning your next campaign.",
      priority: "high",
    },
    scale: {
      key: "path",
      title: "Map your top ACE seller relationships",
      description: "Prioritize co-sell coverage for your largest opportunities.",
      priority: "high",
    },
  };
  return [...base, perPath[path]];
}

/** Progress 0–100 based on how far through the wizard the step is. */
export function progressPercent(step: OnboardingStepId): number {
  if (step === "done") return 100;
  const idx = WIZARD_STEPS.indexOf(step);
  if (idx < 0) return 0;
  return Math.round((idx / WIZARD_STEPS.length) * 100);
}

/** Index of a wizard step (for back-navigation bounds); -1 for 'done'. */
export function stepIndex(step: OnboardingStepId): number {
  return WIZARD_STEPS.indexOf(step);
}
