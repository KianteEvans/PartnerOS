import { and, count, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import {
  onboarding,
  assessments,
  roadmaps,
  programs,
  evidence,
  opportunities,
  mdfRequests,
  solutions,
  tierPlans,
} from "@/db/schema";
import type { ActivationAnswers, ActivationCounts } from "@/domain/onboarding/activation";

/**
 * Live workspace counts that drive the activation checklist. One RLS transaction
 * of cheap COUNT(*) queries; the pure `activationChecklist` turns these + the
 * partner's declared objectives into the "Getting started" list.
 */
export async function loadActivation(
  identity: DbIdentity,
): Promise<{ answers: ActivationAnswers; counts: ActivationCounts }> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;

    const [ob] = await tx
      .select({ objectives: onboarding.objectives })
      .from(onboarding)
      .where(eq(onboarding.tenantId, t))
      .limit(1);

    const [scored] = await tx
      .select({ c: count() })
      .from(assessments)
      .where(and(eq(assessments.tenantId, t), eq(assessments.status, "scored")));
    const [roadmapN] = await tx.select({ c: count() }).from(roadmaps).where(eq(roadmaps.tenantId, t));
    const [programN] = await tx.select({ c: count() }).from(programs).where(eq(programs.tenantId, t));
    const [evidenceN] = await tx.select({ c: count() }).from(evidence).where(eq(evidence.tenantId, t));
    const [oppN] = await tx.select({ c: count() }).from(opportunities).where(eq(opportunities.tenantId, t));
    const [mdfN] = await tx.select({ c: count() }).from(mdfRequests).where(eq(mdfRequests.tenantId, t));
    const [solutionN] = await tx.select({ c: count() }).from(solutions).where(eq(solutions.tenantId, t));
    const [tierN] = await tx.select({ c: count() }).from(tierPlans).where(eq(tierPlans.tenantId, t));

    const counts: ActivationCounts = {
      assessmentScored: (scored?.c ?? 0) > 0,
      roadmaps: roadmapN?.c ?? 0,
      adoptedPrograms: programN?.c ?? 0,
      evidence: evidenceN?.c ?? 0,
      opportunities: oppN?.c ?? 0,
      mdfRequests: mdfN?.c ?? 0,
      solutions: solutionN?.c ?? 0,
      tierPlan: (tierN?.c ?? 0) > 0,
    };
    const answers: ActivationAnswers = {
      objectives: Array.isArray(ob?.objectives) ? (ob.objectives as string[]) : [],
    };
    return { answers, counts };
  });
}
