import { and, eq, inArray } from "drizzle-orm";
import { withTenant, type DbIdentity } from "@/db/client";
import {
  opportunities,
  fundingSubmissions,
  mdfRequests,
  marketplaceListings,
  marketplaceAgreements,
  marketplaceEntitlements,
  opportunityAwsTeam,
  aceRelationships,
} from "@/db/schema";
import { loadFundingMatcher } from "@/domain/funding/load";
import { matchPrograms } from "@/domain/funding/eligibility";
import { computeRepHealth, type RepHealth, type RepRelationship, type RepOpp } from "@/domain/ace/rep-intelligence";
import { assembleDealDesk, type DealDeskModel, type DealDeskParts, type DealOpp, type MdfSupport } from "@/domain/ace/deal-desk";
import { loadOffersForDeal } from "@/domain/marketplace/offer-load";
import { loadCaseStudyLeg } from "@/domain/ace/case-study-match-load";

/**
 * RLS-scoped loader that assembles the full cross-domain picture for ONE ACE
 * opportunity: funding eligibility (reusing the funding matcher), MDF support
 * (loose opportunityRef match), the marketplace agreement chain (solution ->
 * listing -> agreement -> entitlement), and the AWS field team's rep health. The
 * pure `assembleDealDesk` ranks the next moves. Returns null when the opp isn't
 * in the tenant (drives notFound).
 */
export async function loadDealDesk(identity: DbIdentity, oppId: string): Promise<DealDeskModel | null> {
  const today = new Date().toISOString().slice(0, 10);

  // The funding matcher opens its own tenant transaction; call it first (sequential,
  // not nested) to get the deal profile + ranked programs.
  const matcher = await loadFundingMatcher(identity, oppId);
  const matcherDeal = matcher.deals.find((d) => d.id === oppId) ?? null;
  const fundingMatches = matcherDeal ? matchPrograms(matcherDeal.profile, matcher.context) : [];

  return withTenant(identity, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, oppId), eq(opportunities.tenantId, identity.tenantId)));
    if (!opp) return null;

    const appliedRows = await tx
      .select({ programKey: fundingSubmissions.programKey })
      .from(fundingSubmissions)
      .where(and(eq(fundingSubmissions.tenantId, identity.tenantId), eq(fundingSubmissions.opportunityId, oppId)));
    const appliedProgramKeys = appliedRows.map((r) => r.programKey);

    // MDF: best-effort match — opportunityRef is a free-text field, not an FK.
    const refs = [opp.id, opp.externalId, opp.name].filter((x): x is string => typeof x === "string" && x.length > 0);
    const mdfRows = refs.length
      ? await tx
          .select({
            id: mdfRequests.id,
            title: mdfRequests.title,
            status: mdfRequests.status,
            requestedAmount: mdfRequests.requestedAmount,
            approvedAmount: mdfRequests.approvedAmount,
          })
          .from(mdfRequests)
          .where(and(eq(mdfRequests.tenantId, identity.tenantId), inArray(mdfRequests.opportunityRef, refs)))
      : [];
    const mdf: MdfSupport[] = mdfRows.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      requestedAmount: m.requestedAmount,
      approvedAmount: m.approvedAmount,
    }));

    // Marketplace: opp -> solution -> listing(s) -> agreement(s) -> entitlement(s).
    let listings: { id: string; title: string; status: string }[] = [];
    let agreements: { id: string; agreementId: string; offerType: string; status: string; totalValue: number }[] = [];
    let entitlementCount = 0;
    if (opp.solutionId) {
      listings = await tx
        .select({ id: marketplaceListings.id, title: marketplaceListings.title, status: marketplaceListings.status })
        .from(marketplaceListings)
        .where(and(eq(marketplaceListings.tenantId, identity.tenantId), eq(marketplaceListings.solutionId, opp.solutionId)));
      if (listings.length > 0) {
        const listingIds = listings.map((l) => l.id);
        agreements = await tx
          .select({
            id: marketplaceAgreements.id,
            agreementId: marketplaceAgreements.agreementId,
            offerType: marketplaceAgreements.offerType,
            status: marketplaceAgreements.status,
            totalValue: marketplaceAgreements.totalValue,
          })
          .from(marketplaceAgreements)
          .where(and(eq(marketplaceAgreements.tenantId, identity.tenantId), inArray(marketplaceAgreements.listingId, listingIds)));
        if (agreements.length > 0) {
          const agIds = agreements.map((a) => a.agreementId);
          const ents = await tx
            .select({ id: marketplaceEntitlements.id })
            .from(marketplaceEntitlements)
            .where(and(eq(marketplaceEntitlements.tenantId, identity.tenantId), inArray(marketplaceEntitlements.agreementId, agIds)));
          entitlementCount = ents.length;
        }
      }
    }

    // AWS field team + rep health (the opp's team plus its primary contact).
    const teamRows = await tx
      .select({ relationshipId: opportunityAwsTeam.relationshipId })
      .from(opportunityAwsTeam)
      .where(and(eq(opportunityAwsTeam.tenantId, identity.tenantId), eq(opportunityAwsTeam.opportunityId, oppId)));
    const teamRelIds = new Set<string>(teamRows.map((t) => t.relationshipId));
    if (opp.awsContactId) teamRelIds.add(opp.awsContactId);
    let awsTeam: RepHealth[] = [];
    if (teamRelIds.size > 0) {
      const relRows = await tx
        .select()
        .from(aceRelationships)
        .where(and(eq(aceRelationships.tenantId, identity.tenantId), inArray(aceRelationships.id, [...teamRelIds])));
      const allOpps = await tx
        .select({
          accountName: opportunities.accountName,
          status: opportunities.status,
          amount: opportunities.amount,
          source: opportunities.source,
          awsContactId: opportunities.awsContactId,
        })
        .from(opportunities)
        .where(eq(opportunities.tenantId, identity.tenantId));
      const rels: RepRelationship[] = relRows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        accountName: r.accountName,
        strength: r.strength,
        lastContact: r.lastContact,
      }));
      const repOpps: RepOpp[] = allOpps.map((o) => ({
        accountName: o.accountName,
        status: o.status,
        amount: o.amount,
        source: o.source,
        awsContactId: o.awsContactId,
      }));
      awsTeam = computeRepHealth(rels, repOpps, today);
    }

    const dealOpp: DealOpp = {
      id: opp.id,
      name: opp.name,
      accountName: opp.accountName,
      status: opp.status,
      stage: opp.stage,
      amount: opp.amount,
      source: opp.source,
      ownerUserId: opp.ownerUserId,
      nextStep: opp.nextStep,
      lastInteraction: opp.lastInteraction,
      closeDate: opp.closeDate,
      routingStatus: opp.routingStatus,
    };
    // Co-sell private offers drafted for this deal (the marketplace bridge).
    const offers = await loadOffersForDeal(tx, identity.tenantId, oppId);

    // Relevant case studies: attached pins + scored suggestions.
    const caseStudyLeg = await loadCaseStudyLeg(tx, identity.tenantId, oppId, opp);

    const parts: DealDeskParts = {
      opp: dealOpp,
      fundingMatches,
      appliedProgramKeys,
      mdf,
      marketplace: { listings, agreements, entitlementCount },
      offers,
      awsTeam,
      caseStudies: caseStudyLeg.matches,
      caseStudyLibraryCount: caseStudyLeg.libraryCount,
    };
    return assembleDealDesk(parts, today);
  });
}
