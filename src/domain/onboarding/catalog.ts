import type { PresetId } from "@/domain/assessments/catalog";
import { PROGRAM_LIBRARY } from "@/domain/programs/library";
import { tiersAbove, type TierId } from "@/domain/tiers/catalog";

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
 * Objective-specific kickoff tasks, appended one per stated objective. `evidence`
 * is intentionally omitted — the baseline already covers "upload your first case
 * study". Keys are namespaced (`obj:*`) so the sourceRef stays unique.
 */
const OBJECTIVE_TASKS: Record<string, Omit<KickoffTask, "key">> = {
  competency: {
    title: "Pick a target Competency to pursue",
    description: "Open the Recommended view in Program Management and adopt your best-fit Competency.",
    priority: "high",
  },
  tier_advancement: {
    title: "Open your tier advancement plan",
    description: "Review the gap to your next AWS partner tier and start a plan from Program Management.",
    priority: "medium",
  },
  cosell: {
    title: "Add your first AWS co-sell opportunity",
    description: "Create an opportunity in ACE Pipeline to start tracking co-sell with AWS.",
    priority: "high",
  },
  marketplace: {
    title: "Register your first Marketplace Solution",
    description: "Add a Solution to track AWS Marketplace listing readiness.",
    priority: "medium",
  },
  mdf: {
    title: "Check MDF eligibility for a GTM activity",
    description: "Create an MDF request to fund your first co-marketing campaign.",
    priority: "medium",
  },
};

/**
 * The initial tasks seeded into Task Manager when onboarding completes: a shared
 * baseline + a path-specific item + one task per stated objective. Deterministic
 * for a given (path, objectives), with stable, unique keys for the sourceRef.
 */
export function kickoffTasks(
  path: PathId,
  objectives: readonly string[] = [],
): readonly KickoffTask[] {
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
  const objectiveTasks: KickoffTask[] = normalizeObjectives(objectives)
    .filter((key) => key in OBJECTIVE_TASKS)
    .map((key) => ({ key: `obj:${key}`, ...OBJECTIVE_TASKS[key]! }));
  return [...base, perPath[path], ...objectiveTasks];
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

/**
 * Map the self-reported AWS Partner Central stage to a starting PartnerOS tier.
 * Exploring/Registered (and anything unknown) stay at the entry tier; the rest
 * map straight across. Used only as a guarded, upward-only starting estimate.
 */
export function stageToTier(awsStage: string | null | undefined): TierId {
  switch ((awsStage ?? "").trim().toLowerCase()) {
    case "select":
      return "select";
    case "advanced":
      return "advanced";
    case "premier":
      return "premier";
    default:
      return "registered";
  }
}

export interface StarterSelection {
  readonly programKeys: readonly string[];
  readonly targetTier: TierId | null;
}

/**
 * The starter-roadmap selection composed on completion, derived from the chosen
 * path + objectives + AWS stage. Targets the next tier up (advancement-shaped
 * paths or a tier_advancement objective) and seeds 1-2 foundational Competencies
 * when competency-building is a goal. Pure — `composeMilestones` turns it into
 * milestones. May be empty (e.g. Premier + no competency goal); the caller skips
 * roadmap creation in that case.
 */
export function starterRoadmapSelection(
  path: PathId,
  objectives: readonly string[],
  awsStage: string | null | undefined,
): StarterSelection {
  const objs = new Set(normalizeObjectives(objectives));
  const current = stageToTier(awsStage);
  const wantTier = objs.has("tier_advancement") || path === "growth" || path === "scale" || objs.size === 0;
  const targetTier: TierId | null = wantTier ? (tiersAbove(current)[0] ?? null) : null;
  const wantCompetency = objs.has("competency") || path === "foundations";
  const programKeys = wantCompetency
    ? PROGRAM_LIBRARY.filter((p) => p.programType === "Competency").slice(0, 2).map((p) => p.key)
    : [];
  return { programKeys, targetTier };
}

/** One-line helper text shown under each wizard control to reduce guesswork. */
export const FIELD_HELP: Record<string, string> = {
  companyName: "The trading name AWS knows you by — used to name your starter assessment.",
  industry: "Your primary vertical — tailors competency recommendations.",
  partnerType: "How you mainly engage AWS customers — drives your recommended competencies.",
  awsStage: "Your current AWS Partner Central stage — sets your starting tier estimate.",
  teamSize: "Rough headcount working on the AWS partnership.",
  objectives: "Pick what matters most — we tailor your kickoff tasks and starter roadmap to these.",
  path: "Choose the track that matches where you are — it seeds your starter readiness assessment.",
};
