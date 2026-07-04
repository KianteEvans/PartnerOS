import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import {
  marketplaceListings,
  marketplaceCharges,
  marketplaceAttributions,
  marketplaceAttributionConfig,
} from "@/db/schema";
import type { AttributionInsightsInput } from "@/domain/marketplace/attribution-insights";
import type {
  MarketplaceAttributionMethodId,
  MarketplaceAttributionStatusId,
} from "@/domain/marketplace/catalog";

/**
 * RLS loader for the attribution advisor: the raw rows the pure
 * `buildAttributionInsights` engine cross-reads — listings, per-listing method
 * config, attributed revenue, and Marketplace-billed charges. Shared by the
 * Revenue page, the listing detail page, and the gated-AI action (which
 * re-derives everything server-side — never trusts the client).
 */
export async function loadAttributionAdvisor(identity: DbIdentity): Promise<AttributionInsightsInput> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;

    const listings = await tx
      .select({ id: marketplaceListings.id, title: marketplaceListings.title, status: marketplaceListings.status })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, t));

    const configs = await tx
      .select({
        listingId: marketplaceAttributionConfig.listingId,
        method: marketplaceAttributionConfig.method,
        enabled: marketplaceAttributionConfig.enabled,
        status: marketplaceAttributionConfig.status,
      })
      .from(marketplaceAttributionConfig)
      .where(eq(marketplaceAttributionConfig.tenantId, t));

    const attributions = await tx
      .select({
        listingId: marketplaceAttributions.listingId,
        billingPeriod: marketplaceAttributions.billingPeriod,
        amount: marketplaceAttributions.amount,
        method: marketplaceAttributions.method,
      })
      .from(marketplaceAttributions)
      .where(eq(marketplaceAttributions.tenantId, t));

    const charges = await tx
      .select({
        listingId: marketplaceCharges.listingId,
        billingPeriodStart: marketplaceCharges.billingPeriodStart,
        amount: marketplaceCharges.amount,
      })
      .from(marketplaceCharges)
      .where(eq(marketplaceCharges.tenantId, t));

    return {
      listings,
      configs: configs.map((c) => ({
        ...c,
        method: c.method as MarketplaceAttributionMethodId,
        status: c.status as MarketplaceAttributionStatusId,
      })),
      attributions: attributions.map((a) => ({
        ...a,
        method: a.method as MarketplaceAttributionMethodId,
      })),
      // Charges carry a start DATE; the advisor compares months (YYYY-MM).
      charges: charges.map((c) => ({
        listingId: c.listingId,
        period: (c.billingPeriodStart ?? "").slice(0, 7),
        amount: c.amount,
      })),
    };
  });
}
