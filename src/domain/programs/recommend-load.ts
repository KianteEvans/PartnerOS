import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { programs, onboarding, assessments, assessmentModules } from "@/db/schema";
import { env } from "@/env";
import { selectFitSignals } from "@/domain/evidence/fit-load";
import { rankProgramFit } from "@/domain/evidence/fit";
import {
  recommendCompetencies,
  isRecommendedType,
  type CompetencyRecommendation,
  type RecommendProfile,
  type RecommendReadiness,
} from "@/domain/programs/recommend";

/**
 * Read-only loader for the Program Management "Recommended" view. In one RLS
 * transaction it gathers the three signals the recommender blends — evidence (the
 * SAME projection /evidence/fit uses), the persisted business model (onboarding),
 * and the latest scored GTM/readiness assessment — runs the pure engine, and returns
 * a view model. Missing signals degrade gracefully (flagged via has* booleans).
 */

export interface CompetencyRecommendationView {
  readonly recommendations: readonly CompetencyRecommendation[]; // Competency/Specialization/Service Delivery
  readonly all: readonly CompetencyRecommendation[];
  readonly hasProfile: boolean;
  readonly hasAssessment: boolean;
  readonly hasEvidence: boolean;
  readonly adoptedKeys: ReadonlySet<string>;
  readonly adoptedIdByKey: ReadonlyMap<string, string>;
  readonly profile: RecommendProfile;
  readonly aiEnabled: boolean;
}

export async function loadCompetencyRecommendations(
  identity: DbIdentity,
  today: string,
): Promise<CompetencyRecommendationView> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;

    // 1. Evidence -> signals -> ranked fits (shared projection with /evidence/fit).
    const signals = await selectFitSignals(tx, t);
    const fits = rankProgramFit(signals, today);

    // 2. Adopted programs (mark + deep-link).
    const adopted = await tx
      .select({ id: programs.id, libraryKey: programs.libraryKey })
      .from(programs)
      .where(eq(programs.tenantId, t));
    const adoptedKeys = new Set(adopted.map((a) => a.libraryKey));
    const adoptedIdByKey = new Map(adopted.map((a) => [a.libraryKey, a.id]));

    // 3. Persisted business model (onboarding; one row per tenant).
    const [ob] = await tx
      .select({ partnerType: onboarding.partnerType, industry: onboarding.industry, objectives: onboarding.objectives })
      .from(onboarding)
      .where(eq(onboarding.tenantId, t))
      .limit(1);
    const profile: RecommendProfile = {
      partnerType: ob?.partnerType ?? null,
      industry: ob?.industry ?? null,
    };
    const hasProfile = Boolean(ob && (ob.partnerType || ob.industry));
    const objectives = Array.isArray(ob?.objectives) ? (ob.objectives as string[]) : [];

    // 4. Latest scored GTM/readiness assessment + its module scores.
    const [scored] = await tx
      .select({
        id: assessments.id,
        targetProgram: assessments.targetProgram,
        overallScore: assessments.overallScore,
      })
      .from(assessments)
      .where(and(eq(assessments.tenantId, t), eq(assessments.status, "scored")))
      .orderBy(desc(assessments.submittedAt), desc(assessments.createdAt))
      .limit(1);

    let readiness: RecommendReadiness = {};
    if (scored) {
      const mods = await tx
        .select({ module: assessmentModules.module, score: assessmentModules.score })
        .from(assessmentModules)
        .where(and(eq(assessmentModules.assessmentId, scored.id), eq(assessmentModules.tenantId, t)));
      const scoreOf = (m: string): number | undefined => {
        const row = mods.find((x) => x.module === m);
        return row && row.score !== null ? row.score : undefined;
      };
      readiness = {
        gtm: scoreOf("gtm"),
        competency: scoreOf("competency"),
        specialization: scoreOf("specialization"),
        overall: scored.overallScore ?? undefined,
        targetProgram: scored.targetProgram,
      };
    }

    const all = recommendCompetencies({ fits, profile, readiness, adoptedKeys, objectives });
    const recommendations = all.filter((r) => isRecommendedType(r.programType));

    return {
      recommendations,
      all,
      hasProfile,
      hasAssessment: Boolean(scored),
      hasEvidence: signals.length > 0,
      adoptedKeys,
      adoptedIdByKey,
      profile,
      aiEnabled: Boolean(env.ANTHROPIC_API_KEY),
    };
  });
}
