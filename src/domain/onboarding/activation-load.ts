import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { onboarding } from "@/db/schema";
import type { ActivationAnswers, ActivationCounts } from "@/domain/onboarding/activation";

/**
 * Live workspace counts that drive the activation checklist. ONE round trip of
 * scalar COUNT subqueries (was eight separate COUNT(*) statements — each a full
 * protocol round trip on the transaction's single connection); the pure
 * `activationChecklist` turns these + the partner's declared objectives into
 * the "Getting started" list. Runs under the tenant role, so RLS still applies
 * to every subquery; the explicit tenant_id predicates keep the index paths.
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

    const res = await tx.execute(sql`
      select
        (select count(*)::int from assessments where tenant_id = ${t} and status = 'scored') as scored,
        (select count(*)::int from roadmaps where tenant_id = ${t}) as roadmaps,
        (select count(*)::int from programs where tenant_id = ${t}) as programs,
        (select count(*)::int from evidence where tenant_id = ${t}) as evidence,
        (select count(*)::int from opportunities where tenant_id = ${t}) as opportunities,
        (select count(*)::int from mdf_requests where tenant_id = ${t}) as mdf,
        (select count(*)::int from solutions where tenant_id = ${t}) as solutions,
        (select count(*)::int from tier_plans where tenant_id = ${t}) as tier_plans
    `);
    const c = (res as unknown as Array<Record<string, number>>)[0] ?? {};

    const counts: ActivationCounts = {
      assessmentScored: (c.scored ?? 0) > 0,
      roadmaps: c.roadmaps ?? 0,
      adoptedPrograms: c.programs ?? 0,
      evidence: c.evidence ?? 0,
      opportunities: c.opportunities ?? 0,
      mdfRequests: c.mdf ?? 0,
      solutions: c.solutions ?? 0,
      tierPlan: (c.tier_plans ?? 0) > 0,
    };
    const answers: ActivationAnswers = {
      objectives: Array.isArray(ob?.objectives) ? (ob.objectives as string[]) : [],
    };
    return { answers, counts };
  });
}
