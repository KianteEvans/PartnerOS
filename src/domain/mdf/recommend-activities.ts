import {
  APPROVED_ACTIVITIES,
  type ActivityCategory,
  type CatalogActivity,
} from "@/domain/mdf/activity-catalog";

/**
 * Pure "recommended AWS activities for you" scorer over the approved MDF catalog.
 * Blends the partner's onboarding objectives, their business model, and the
 * activity-type mix they've already funded (favour fresh channels). Deterministic
 * and testable; mirrors the objective-nudge idea in `programs/recommend.ts`.
 */

export interface ActivityRecInput {
  readonly objectives: readonly string[];
  /** Onboarding partner type / business model, lower-cased match. */
  readonly businessModel: string | null;
  /** mdf_activity_type categories the partner has already run. */
  readonly usedCategories: ReadonlySet<string>;
}

export interface ScoredActivity {
  readonly activity: CatalogActivity;
  readonly score: number;
  readonly rationale: string;
}

const OBJECTIVE_TOKENS: ReadonlyArray<{ token: string; label: string; categories: readonly ActivityCategory[] }> = [
  { token: "pipeline", label: "build pipeline", categories: ["campaign", "event"] },
  { token: "demand", label: "drive demand generation", categories: ["campaign", "event"] },
  { token: "lead", label: "generate leads", categories: ["campaign"] },
  { token: "cosell", label: "co-sell with AWS", categories: ["event"] },
  { token: "co-sell", label: "co-sell with AWS", categories: ["event"] },
  { token: "brand", label: "build brand awareness", categories: ["content", "event"] },
  { token: "aware", label: "build brand awareness", categories: ["content", "event"] },
  { token: "enable", label: "enable your team", categories: ["enablement"] },
  { token: "market", label: "expand marketing reach", categories: ["campaign", "content"] },
];

const MODEL_LEAN: Readonly<Record<string, Partial<Record<ActivityCategory, number>>>> = {
  consult: { event: 15, enablement: 10, content: 6, campaign: 4, other: 4 },
  service: { event: 15, enablement: 10, content: 6, campaign: 4, other: 4 },
  isv: { campaign: 15, content: 12, event: 6, enablement: 4, other: 4 },
  software: { campaign: 15, content: 12, event: 6, enablement: 4, other: 4 },
};

/** The objective (if any) that an activity category supports, with its label. */
function objectiveAlign(objectives: readonly string[], category: ActivityCategory): string | null {
  for (const obj of objectives) {
    const lo = obj.toLowerCase();
    for (const t of OBJECTIVE_TOKENS) {
      if (lo.includes(t.token) && t.categories.includes(category)) return t.label;
    }
  }
  return null;
}

function modelLean(businessModel: string | null, category: ActivityCategory): number {
  if (!businessModel) return 6;
  const lo = businessModel.toLowerCase();
  for (const key of Object.keys(MODEL_LEAN)) {
    if (lo.includes(key)) return MODEL_LEAN[key]![category] ?? 6;
  }
  return 6;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

export function recommendActivities(input: ActivityRecInput): ScoredActivity[] {
  return APPROVED_ACTIVITIES.map((activity) => {
    const aligned = objectiveAlign(input.objectives, activity.category);
    const lean = modelLean(input.businessModel, activity.category);
    const fresh = !input.usedCategories.has(activity.category);

    const score = clamp(50 + (aligned ? 14 : 0) + lean + (fresh ? 10 : 3));
    const rationale = aligned
      ? `Supports your goal to ${aligned}.`
      : lean >= 12
        ? `A strong fit for your business model.`
        : fresh
          ? `A marketing channel you haven't used yet.`
          : `An approved MDF activity.`;
    return { activity, score, rationale };
  }).sort((a, b) => b.score - a.score || a.activity.label.localeCompare(b.activity.label));
}
