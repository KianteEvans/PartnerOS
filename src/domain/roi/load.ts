import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { mdfRequests, fundingSubmissions, opportunities, tierPlans, tierRequirements } from "@/db/schema";
import { roiLoop, type SpendRecord, type LinkedOpp, type RoiFunnel } from "./loop";

/**
 * Full ROI loop loader (Wave 2). Reads the SPEND side (approved MDF + Funding) and
 * the OUTCOME side (opportunities), resolves each spend record's primary opportunity
 * (MDF prefers the new `opportunity_id` FK and falls back to the free-text
 * `opportunity_ref` match for un-migrated rows; Funding uses its FK), then folds them
 * into the portfolio funnel via the pure `roiLoop`. Also surfaces the tenant's
 * `launched_opportunities` tier-requirement progress (the loop's tail).
 */

export interface TierCredit {
  readonly targetTier: string;
  readonly launched: number;
  readonly threshold: number;
}

export interface RoiLoopView {
  readonly funnel: RoiFunnel;
  readonly tierCredit: TierCredit | null;
}

export async function loadRoiLoop(identity: DbIdentity): Promise<RoiLoopView> {
  return withTenant(identity, async (tx): Promise<RoiLoopView> => {
    const t = identity.tenantId;

    const opps = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        externalId: opportunities.externalId,
        status: opportunities.status,
        stage: opportunities.stage,
        amount: opportunities.amount,
      })
      .from(opportunities)
      .where(eq(opportunities.tenantId, t));

    const oppsById = new Map<string, LinkedOpp>();
    // Fallback index for MDF rows still linked only by free-text ref (id/externalId/name).
    const byRef = new Map<string, string>();
    for (const o of opps) {
      oppsById.set(o.id, { id: o.id, name: o.name, status: o.status, stage: o.stage, amount: o.amount });
      byRef.set(o.id, o.id);
      if (o.externalId) byRef.set(o.externalId, o.id);
      byRef.set(o.name, o.id);
    }
    const resolveRef = (ref: string | null): string | null => (ref ? (byRef.get(ref) ?? null) : null);

    const mdfRows = await tx
      .select({
        id: mdfRequests.id,
        title: mdfRequests.title,
        approvedAmount: mdfRequests.approvedAmount,
        expectedPipeline: mdfRequests.expectedPipeline,
        opportunityId: mdfRequests.opportunityId,
        opportunityRef: mdfRequests.opportunityRef,
      })
      .from(mdfRequests)
      .where(eq(mdfRequests.tenantId, t));

    const fundingRows = await tx
      .select({
        id: fundingSubmissions.id,
        title: fundingSubmissions.title,
        approvedAmount: fundingSubmissions.approvedAmount,
        opportunityId: fundingSubmissions.opportunityId,
      })
      .from(fundingSubmissions)
      .where(eq(fundingSubmissions.tenantId, t));

    const records: SpendRecord[] = [];
    for (const m of mdfRows) {
      const approved = m.approvedAmount ?? 0;
      if (approved <= 0) continue; // only committed (approved) spend counts
      records.push({
        kind: "mdf",
        id: m.id,
        title: m.title,
        approved,
        expectedPipeline: m.expectedPipeline,
        opportunityId: m.opportunityId ?? resolveRef(m.opportunityRef),
      });
    }
    for (const f of fundingRows) {
      const approved = f.approvedAmount ?? 0;
      if (approved <= 0) continue;
      records.push({
        kind: "funding",
        id: f.id,
        title: f.title,
        approved,
        expectedPipeline: 0, // Funding has no expected-pipeline field
        opportunityId: f.opportunityId ?? null,
      });
    }

    const funnel = roiLoop(records, oppsById);

    // Tier-credit tail: the launched_opportunities requirement on the active plan.
    const [plan] = await tx
      .select({ id: tierPlans.id, targetTier: tierPlans.targetTier })
      .from(tierPlans)
      .where(eq(tierPlans.tenantId, t))
      .limit(1);
    let tierCredit: TierCredit | null = null;
    if (plan) {
      const [req] = await tx
        .select({ threshold: tierRequirements.threshold, currentValue: tierRequirements.currentValue })
        .from(tierRequirements)
        .where(
          and(
            eq(tierRequirements.planId, plan.id),
            eq(tierRequirements.requirementKey, "launched_opportunities"),
          ),
        )
        .limit(1);
      if (req) {
        tierCredit = { targetTier: plan.targetTier, launched: req.currentValue, threshold: req.threshold };
      }
    }

    return { funnel, tierCredit };
  });
}
