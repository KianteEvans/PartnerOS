import { eq, isNotNull, and } from "drizzle-orm";
import { withTenant, type DbIdentity } from "@/db/client";
import {
  opportunities,
  mdfRequests,
  fundingSubmissions,
  marketplacePrivateOffers,
  opportunityAwsTeam,
  aceRelationships,
} from "@/db/schema";
import {
  mineWinLoss,
  repWinRows,
  strengthSplit,
  type ClosedDeal,
  type WinLossReport,
  type RepWinRow,
  type StrengthSplit,
  type RepWinOpp,
} from "@/domain/ace/winloss";

/**
 * Read-only win/loss mining loader: one tenant-scoped (RLS) transaction gathers the
 * CLOSED deals plus the five cross-domain factor link-sets (MDF via FK + free-text
 * ref fallback, funding, private offers, AWS-team junction + direct contact) and the
 * AWS relationships, then hands everything to the pure engine.
 */

export interface WinLossView {
  readonly report: WinLossReport;
  readonly deals: readonly ClosedDeal[];
  readonly reps: readonly RepWinRow[];
  readonly strength: StrengthSplit;
}

const isoDay = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export async function loadWinLoss(identity: DbIdentity): Promise<WinLossView> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;

    const opps = await tx.select().from(opportunities).where(eq(opportunities.tenantId, t));

    // MDF backing: prefer the opportunity_id FK, fall back to the free-text ref
    // (matched on id / externalId / name — the roi/load idiom).
    const byRef = new Map<string, string>();
    for (const o of opps) {
      byRef.set(o.id, o.id);
      if (o.externalId) byRef.set(o.externalId, o.id);
      byRef.set(o.name, o.id);
    }
    const mdfRows = await tx
      .select({ opportunityId: mdfRequests.opportunityId, opportunityRef: mdfRequests.opportunityRef })
      .from(mdfRequests)
      .where(eq(mdfRequests.tenantId, t));
    const mdfOppIds = new Set<string>();
    for (const m of mdfRows) {
      const id = m.opportunityId ?? (m.opportunityRef ? (byRef.get(m.opportunityRef) ?? null) : null);
      if (id) mdfOppIds.add(id);
    }

    const fundingRows = await tx
      .select({ opportunityId: fundingSubmissions.opportunityId })
      .from(fundingSubmissions)
      .where(and(eq(fundingSubmissions.tenantId, t), isNotNull(fundingSubmissions.opportunityId)));
    const fundingOppIds = new Set(fundingRows.map((r) => r.opportunityId!));

    const offerRows = await tx
      .select({ opportunityId: marketplacePrivateOffers.opportunityId })
      .from(marketplacePrivateOffers)
      .where(and(eq(marketplacePrivateOffers.tenantId, t), isNotNull(marketplacePrivateOffers.opportunityId)));
    const offerOppIds = new Set(offerRows.map((r) => r.opportunityId!));

    const teamRows = await tx
      .select({ opportunityId: opportunityAwsTeam.opportunityId })
      .from(opportunityAwsTeam)
      .where(eq(opportunityAwsTeam.tenantId, t));
    const teamOppIds = new Set(teamRows.map((r) => r.opportunityId));

    const rels = await tx
      .select({
        id: aceRelationships.id,
        name: aceRelationships.name,
        role: aceRelationships.role,
        accountName: aceRelationships.accountName,
        strength: aceRelationships.strength,
      })
      .from(aceRelationships)
      .where(eq(aceRelationships.tenantId, t));

    const deals: ClosedDeal[] = opps
      .filter((o) => o.status !== "open")
      .map((o) => ({
        id: o.id,
        name: o.name,
        status: o.status as "won" | "lost",
        amount: o.amount,
        source: o.source,
        stage: o.stage,
        lossReason: o.lossReason,
        createdAt: o.createdAt.toISOString().slice(0, 10),
        closedAt: isoDay(o.closedAt),
        hasMdf: mdfOppIds.has(o.id),
        hasFunding: fundingOppIds.has(o.id),
        hasOffer: offerOppIds.has(o.id),
        hasAwsTeam: teamOppIds.has(o.id) || o.awsContactId !== null,
        hasCompetency: o.programId !== null,
        hasSolution: o.solutionId !== null,
      }));

    const repOpps: RepWinOpp[] = opps.map((o) => ({
      status: o.status,
      amount: o.amount,
      accountName: o.accountName,
      awsContactId: o.awsContactId,
    }));

    return {
      report: mineWinLoss(deals),
      deals,
      reps: repWinRows(rels, repOpps),
      strength: strengthSplit(rels, repOpps),
    };
  });
}
