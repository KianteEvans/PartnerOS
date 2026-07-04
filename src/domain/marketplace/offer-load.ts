import { and, desc, eq } from "drizzle-orm";
import { withTenant, type DbIdentity } from "@/db/client";
import { marketplacePrivateOffers, opportunities, marketplaceListings } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import type { DeskOffer } from "@/domain/ace/deal-desk";
import type { PrivateOfferStatus } from "@/domain/marketplace/private-offers";

/**
 * Read-only loaders for co-sell private offers. The tracker list joins the backing
 * co-sell deal + the listing for display; the deal-desk slice returns the compact
 * DeskOffer shape the pure aggregator consumes. Tenant-scoped via RLS.
 */

export interface PrivateOfferListRow {
  readonly id: string;
  readonly title: string;
  readonly status: PrivateOfferStatus;
  readonly offerValue: number;
  readonly currency: string;
  readonly discountPct: number;
  readonly customerName: string;
  readonly expirationDate: string | null;
  readonly opportunityId: string | null;
  readonly opportunityName: string | null;
  readonly listingTitle: string | null;
  readonly agreementId: string | null;
}

export async function loadPrivateOffers(identity: DbIdentity): Promise<PrivateOfferListRow[]> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        id: marketplacePrivateOffers.id,
        title: marketplacePrivateOffers.title,
        status: marketplacePrivateOffers.status,
        offerValue: marketplacePrivateOffers.offerValue,
        currency: marketplacePrivateOffers.currency,
        discountPct: marketplacePrivateOffers.discountPct,
        customerName: marketplacePrivateOffers.customerName,
        expirationDate: marketplacePrivateOffers.expirationDate,
        opportunityId: marketplacePrivateOffers.opportunityId,
        opportunityName: opportunities.name,
        listingTitle: marketplaceListings.title,
        agreementId: marketplacePrivateOffers.agreementId,
      })
      .from(marketplacePrivateOffers)
      .leftJoin(opportunities, eq(opportunities.id, marketplacePrivateOffers.opportunityId))
      .leftJoin(marketplaceListings, eq(marketplaceListings.id, marketplacePrivateOffers.listingId))
      .where(eq(marketplacePrivateOffers.tenantId, identity.tenantId))
      .orderBy(desc(marketplacePrivateOffers.createdAt));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      offerValue: r.offerValue,
      currency: r.currency,
      discountPct: r.discountPct,
      customerName: r.customerName,
      expirationDate: r.expirationDate,
      opportunityId: r.opportunityId,
      opportunityName: r.opportunityName,
      listingTitle: r.listingTitle,
      agreementId: r.agreementId,
    }));
  });
}

export interface OfferFormOptions {
  readonly opps: readonly { id: string; name: string; accountName: string }[];
  readonly listings: readonly { id: string; title: string }[];
}

/** Open deals + listings to populate the standalone "New private offer" drawer. */
export async function loadOfferFormOptions(identity: DbIdentity): Promise<OfferFormOptions> {
  return withTenant(identity, async (tx) => {
    const opps = await tx
      .select({ id: opportunities.id, name: opportunities.name, accountName: opportunities.accountName })
      .from(opportunities)
      .where(and(eq(opportunities.tenantId, identity.tenantId), eq(opportunities.status, "open")))
      .orderBy(desc(opportunities.amount));
    const listings = await tx
      .select({ id: marketplaceListings.id, title: marketplaceListings.title })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, identity.tenantId));
    return { opps, listings };
  });
}

/** The compact offer slice for one deal, run on an existing tenant tx (Deal Desk). */
export async function loadOffersForDeal(
  tx: MutationContext["tx"],
  tenantId: string,
  oppId: string,
): Promise<DeskOffer[]> {
  const rows = await tx
    .select({
      id: marketplacePrivateOffers.id,
      title: marketplacePrivateOffers.title,
      status: marketplacePrivateOffers.status,
      offerValue: marketplacePrivateOffers.offerValue,
      agreementId: marketplacePrivateOffers.agreementId,
    })
    .from(marketplacePrivateOffers)
    .where(and(eq(marketplacePrivateOffers.tenantId, tenantId), eq(marketplacePrivateOffers.opportunityId, oppId)));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    offerValue: r.offerValue,
    agreementId: r.agreementId,
  }));
}
