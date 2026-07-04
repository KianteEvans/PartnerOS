import type { DbIdentity } from "@/db/client";
import { loadCompetencyRecommendations } from "@/domain/programs/recommend-load";
import { filterRecommendations, type RoadmapRecommendation } from "@/domain/roadmaps/recommend-filter";

/**
 * Roadmap-scoped wrapper over the competency recommender. Reuses the SAME engine
 * the Program Management "Recommended" view uses (evidence fit + business model +
 * assessment readiness + objectives), then drops programs already adopted or
 * already on the roadmap (the pure `filterRecommendations` from recommend-filter)
 * and returns a lean view the composer / grow drawer pass around. Missing signals
 * degrade gracefully — the recommender still returns a 0-100 ranking.
 */

export type { RoadmapRecommendation } from "@/domain/roadmaps/recommend-filter";

export interface RoadmapRecommendView {
  readonly recommendations: readonly RoadmapRecommendation[];
  readonly hasProfile: boolean;
  readonly hasAssessment: boolean;
  readonly hasEvidence: boolean;
  readonly aiEnabled: boolean;
}

export async function loadRoadmapRecommendations(
  identity: DbIdentity,
  today: string,
  excludeKeys: ReadonlySet<string>,
): Promise<RoadmapRecommendView> {
  const view = await loadCompetencyRecommendations(identity, today);
  return {
    recommendations: filterRecommendations(view.recommendations, excludeKeys),
    hasProfile: view.hasProfile,
    hasAssessment: view.hasAssessment,
    hasEvidence: view.hasEvidence,
    aiEnabled: view.aiEnabled,
  };
}
