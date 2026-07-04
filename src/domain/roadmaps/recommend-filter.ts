import { getLibraryProgram } from "@/domain/programs/library";
import type { CompetencyRecommendation } from "@/domain/programs/recommend";

/**
 * Pure mapping for roadmap-scoped program recommendations — kept free of any DB
 * import so it is unit-testable in isolation. Drops programs already adopted or
 * already on the roadmap, preserves the recommender's rank order, and maps to the
 * lean shape the composer / grow drawer pass around. The DB-touching loader lives
 * in recommend-load.ts and reuses this.
 */

/** The subset of a competency recommendation the roadmap surfaces actually read. */
export type RecommendationInput = Pick<
  CompetencyRecommendation,
  | "programKey"
  | "name"
  | "programType"
  | "deliveryModel"
  | "fundingFit"
  | "recommendationScore"
  | "band"
  | "isAdopted"
  | "rationale"
>;

export interface RoadmapRecommendation {
  readonly key: string;
  readonly name: string;
  readonly programType: string;
  readonly deliveryModel: string;
  readonly fundingFit: string;
  readonly requirementCount: number;
  readonly score: number;
  readonly band: CompetencyRecommendation["band"];
  readonly topRationale: readonly { readonly label: string; readonly detail: string; readonly tone: string }[];
}

/** Drop adopted/excluded programs, keep rank order, map to the lean shape. */
export function filterRecommendations(
  recs: readonly RecommendationInput[],
  excludeKeys: ReadonlySet<string>,
): RoadmapRecommendation[] {
  return recs
    .filter((r) => !r.isAdopted && !excludeKeys.has(r.programKey))
    .map((r) => ({
      key: r.programKey,
      name: r.name,
      programType: r.programType,
      deliveryModel: r.deliveryModel,
      fundingFit: r.fundingFit,
      requirementCount: getLibraryProgram(r.programKey)?.requirements.length ?? 0,
      score: r.recommendationScore,
      band: r.band,
      topRationale: r.rationale.slice(0, 2).map((c) => ({ label: c.label, detail: c.detail, tone: c.tone })),
    }));
}
