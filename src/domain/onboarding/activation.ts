import { normalizeObjectives } from "@/domain/onboarding/catalog";

/**
 * Pure "Getting started" activation checklist. After onboarding unlocks the
 * workspace, this guides the partner to first value: a small set of baseline
 * milestones plus objective-driven items for the goals they declared. `done` is
 * derived from live workspace counts (the loader supplies them) — no DB, no clock,
 * so it's deterministic and unit-testable. Mirrors settings/readiness.ts.
 */

export interface ActivationAnswers {
  readonly objectives: readonly string[];
}

export interface ActivationCounts {
  readonly assessmentScored: boolean;
  readonly roadmaps: number;
  readonly adoptedPrograms: number;
  readonly evidence: number;
  readonly opportunities: number;
  readonly mdfRequests: number;
  readonly solutions: number;
  readonly tierPlan: boolean;
}

export interface ActivationItem {
  readonly key: string;
  readonly label: string;
  readonly done: boolean;
  readonly href: string;
  readonly cta: string;
  /** True when the item was added because the partner declared the matching goal. */
  readonly objectiveDriven: boolean;
}

export interface Activation {
  readonly items: readonly ActivationItem[];
  readonly doneCount: number;
  readonly total: number;
  /** 0-100. */
  readonly percent: number;
  readonly complete: boolean;
}

/** Objective key -> the activation item it adds. `competency` and `evidence` are
 *  intentionally absent — they're already baseline items below. */
const OBJECTIVE_ITEMS: Record<
  string,
  { label: string; href: string; cta: string; done: (c: ActivationCounts) => boolean }
> = {
  cosell: { label: "Add your first AWS opportunity", href: "/ace", cta: "Open ACE", done: (c) => c.opportunities > 0 },
  mdf: { label: "Create your first MDF request", href: "/mdf", cta: "Open MDF", done: (c) => c.mdfRequests > 0 },
  marketplace: { label: "Register your first Solution", href: "/programs?view=solutions", cta: "Open Solutions", done: (c) => c.solutions > 0 },
  tier_advancement: { label: "Open your tier advancement plan", href: "/programs/tiers", cta: "Open tiers", done: (c) => c.tierPlan },
};

export function activationChecklist(
  answers: ActivationAnswers,
  counts: ActivationCounts,
): Activation {
  const items: ActivationItem[] = [
    { key: "assessment", label: "Score your readiness assessment", href: "/plan", cta: "Open assessment", done: counts.assessmentScored, objectiveDriven: false },
    { key: "roadmap", label: "Build your first roadmap", href: "/plan/roadmaps", cta: "View roadmap", done: counts.roadmaps > 0, objectiveDriven: false },
    { key: "competency", label: "Pursue your first Competency", href: "/programs?view=recommended", cta: "See recommendations", done: counts.adoptedPrograms > 0, objectiveDriven: false },
    { key: "evidence", label: "Upload your first evidence", href: "/programs/evidence", cta: "Add evidence", done: counts.evidence > 0, objectiveDriven: false },
  ];

  for (const key of normalizeObjectives(answers.objectives)) {
    const def = OBJECTIVE_ITEMS[key];
    if (!def) continue; // competency / evidence already covered by the baseline
    items.push({ key: `obj:${key}`, label: def.label, href: def.href, cta: def.cta, done: def.done(counts), objectiveDriven: true });
  }

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  return { items, doneCount, total, percent, complete: doneCount === total };
}
