import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { deferAfterResponse } from "@/http/defer";
import {
  awsConnection,
  marketplaceListings,
  marketplacePricingDimensions,
  marketplaceChangeSets,
  marketplaceMeteringRecords,
  marketplaceEntitlements,
  marketplaceAgreements,
  marketplaceCharges,
  marketplaceAttributions,
  marketplaceAttributionConfig,
  marketplaceRevenueSnapshots,
  marketplaceCustomers,
  marketplacePrivateOffers,
  solutions,
} from "@/db/schema";
import type { MeteringRecordStatus } from "@/domain/marketplace/metering";
import { marketplaceTrendSeries, type MarketplaceTrends } from "@/domain/marketplace/trend";
import { entitlementStatus } from "@/domain/marketplace/entitlements";
import { rollupCustomers, type CustomerRollup } from "@/domain/marketplace/customers";
import type { MutationContext } from "@/gate/mutation-gate";
import type { CommandMarketplaceListing } from "@/domain/command/types";
import type {
  MarketplaceAttributionMethodId,
  MarketplaceAttributionStatusId,
} from "@/domain/marketplace/catalog";

/**
 * Capture today's marketplace snapshot row (best-effort, idempotent by tenant+day) so the
 * daily sparkline series grows. Shared by loadRevenue + loadMarketplaceTrends. The metered
 * usage + MRR series stay best-effort (0); revenue / listings / entitlements are real.
 */
async function captureMarketplaceSnapshotRow(
  tx: MutationContext["tx"],
  tenantId: string,
  today: string,
  attributedRevenueCents: number,
): Promise<void> {
  try {
    const [counts] = await tx
      .select({
        listings: sql<number>`count(*)::int`,
        published: sql<number>`count(*) filter (where ${marketplaceListings.status} = 'published')::int`,
      })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, tenantId));
    const [ent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(marketplaceEntitlements)
      .where(eq(marketplaceEntitlements.tenantId, tenantId));
    const values = {
      listings: counts?.listings ?? 0,
      published: counts?.published ?? 0,
      activeEntitlements: ent?.n ?? 0,
      attributedRevenueCents,
    };
    await tx
      .insert(marketplaceRevenueSnapshots)
      .values({ tenantId, capturedOn: today, meteredUsageCents: 0, mrrCents: 0, ...values })
      .onConflictDoUpdate({
        target: [marketplaceRevenueSnapshots.tenantId, marketplaceRevenueSnapshots.capturedOn],
        set: { ...values, updatedAt: sql`now()` },
      });
  } catch {
    // snapshot capture is best-effort -- never blocks the page
  }
}

/**
 * The last 14 days as per-metric sparkline series (RLS-scoped). The daily
 * capture upsert is DEFERRED past the response; today's live revenue value is
 * overlaid in memory so the series still ends at "now" before the write lands.
 */
export async function loadMarketplaceTrends(identity: DbIdentity, today: string): Promise<MarketplaceTrends> {
  const { cents, rows } = await withTenant(identity, async (tx) => {
    const [rev] = await tx
      .select({ cents: sql<number>`coalesce(sum(${marketplaceAttributions.amount}), 0)::int` })
      .from(marketplaceAttributions)
      .where(eq(marketplaceAttributions.tenantId, identity.tenantId));
    const snapshotRows = await tx
      .select()
      .from(marketplaceRevenueSnapshots)
      .where(eq(marketplaceRevenueSnapshots.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceRevenueSnapshots.capturedOn))
      .limit(14);
    return { cents: rev?.cents ?? 0, rows: snapshotRows };
  });
  await deferAfterResponse(() => captureMarketplaceSnapshot(identity, today, cents));
  const withToday =
    rows[0]?.capturedOn === today
      ? [{ ...rows[0], attributedRevenueCents: cents }, ...rows.slice(1)]
      : rows[0]
        ? [{ ...rows[0], capturedOn: today, attributedRevenueCents: cents }, ...rows].slice(0, 14)
        : rows;
  return marketplaceTrendSeries(withToday);
}

/** Deferred-capture entry: the daily snapshot upsert in its own tenant transaction. */
export async function captureMarketplaceSnapshot(
  identity: DbIdentity,
  today: string,
  attributedRevenueCents: number,
): Promise<void> {
  await withTenant(identity, (tx) =>
    captureMarketplaceSnapshotRow(tx, identity.tenantId, today, attributedRevenueCents),
  );
}
import type {
  MarketplaceProductTypeId,
  MarketplaceVisibilityId,
  MarketplaceListingStatusId,
  MarketplaceDimensionTypeId,
  MarketplaceChangeIntentId,
} from "@/domain/marketplace/catalog";
import type { MarketplaceChangeStatusId } from "@/domain/marketplace/mapping";

/**
 * Read-only AWS Marketplace loaders (tenant-scoped via RLS). The mirror tables are the
 * rendered projection of AWS; loaders never call AWS (sync does that). No mutations.
 */

export interface MarketplaceConnState {
  readonly enabled: boolean;
  readonly status: string;
  readonly lastSyncedAt: Date | null;
  readonly lastError: string | null;
}

export async function loadMarketplaceConnState(identity: DbIdentity): Promise<MarketplaceConnState> {
  const [c] = await withTenant(identity, (tx) =>
    tx
      .select({
        enabled: awsConnection.marketplaceEnabled,
        status: awsConnection.marketplaceStatus,
        lastSyncedAt: awsConnection.marketplaceLastSyncedAt,
        lastError: awsConnection.marketplaceLastError,
      })
      .from(awsConnection)
      .where(eq(awsConnection.tenantId, identity.tenantId)),
  );
  return {
    enabled: c?.enabled ?? false,
    status: c?.status ?? "not_configured",
    lastSyncedAt: c?.lastSyncedAt ?? null,
    lastError: c?.lastError ?? null,
  };
}

export interface ListingListItem {
  readonly id: string;
  readonly entityId: string;
  readonly title: string;
  readonly productType: MarketplaceProductTypeId;
  readonly visibility: MarketplaceVisibilityId;
  readonly status: MarketplaceListingStatusId;
  readonly dimensionCount: number;
  readonly lastSyncedAt: Date | null;
}

export async function loadListings(identity: DbIdentity): Promise<ListingListItem[]> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select()
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceListings.createdAt));
    const dims = await tx
      .select({ listingId: marketplacePricingDimensions.listingId })
      .from(marketplacePricingDimensions)
      .where(eq(marketplacePricingDimensions.tenantId, identity.tenantId));
    const counts = new Map<string, number>();
    for (const d of dims) counts.set(d.listingId, (counts.get(d.listingId) ?? 0) + 1);
    return rows.map((r) => ({
      id: r.id,
      entityId: r.entityId,
      title: r.title,
      productType: r.productType as MarketplaceProductTypeId,
      visibility: r.visibility as MarketplaceVisibilityId,
      status: r.status as MarketplaceListingStatusId,
      dimensionCount: counts.get(r.id) ?? 0,
      lastSyncedAt: r.lastSyncedAt,
    }));
  });
}

export interface MeteringRecordItem {
  readonly id: string;
  readonly listingId: string;
  readonly listingTitle: string;
  readonly dimension: string;
  readonly customerIdentifier: string;
  readonly quantity: number;
  readonly status: MeteringRecordStatus;
  /** AWS result string; "Resubmitted" marks a rejected record already retried. */
  readonly result: string;
  readonly usageTimestamp: Date;
}

export interface MeteringData {
  readonly records: readonly MeteringRecordItem[];
  readonly prices: ReadonlyArray<{ apiName: string; price: number }>;
  readonly listings: ReadonlyArray<{ id: string; title: string }>;
}

export async function loadMetering(identity: DbIdentity): Promise<MeteringData> {
  return withTenant(identity, async (tx) => {
    const records = await tx
      .select({
        id: marketplaceMeteringRecords.id,
        listingId: marketplaceMeteringRecords.listingId,
        listingTitle: marketplaceListings.title,
        dimension: marketplaceMeteringRecords.dimension,
        customerIdentifier: marketplaceMeteringRecords.customerIdentifier,
        quantity: marketplaceMeteringRecords.quantity,
        status: marketplaceMeteringRecords.status,
        result: marketplaceMeteringRecords.result,
        usageTimestamp: marketplaceMeteringRecords.usageTimestamp,
      })
      .from(marketplaceMeteringRecords)
      .innerJoin(marketplaceListings, eq(marketplaceListings.id, marketplaceMeteringRecords.listingId))
      .where(eq(marketplaceMeteringRecords.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceMeteringRecords.usageTimestamp));
    const prices = await tx
      .select({ apiName: marketplacePricingDimensions.apiName, price: marketplacePricingDimensions.price })
      .from(marketplacePricingDimensions)
      .where(eq(marketplacePricingDimensions.tenantId, identity.tenantId));
    const listings = await tx
      .select({ id: marketplaceListings.id, title: marketplaceListings.title })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceListings.createdAt));
    return {
      records: records.map((r) => ({ ...r, status: r.status as MeteringRecordStatus })),
      prices,
      listings,
    };
  });
}

export interface EntitlementItem {
  readonly id: string;
  readonly listingTitle: string | null;
  readonly customerIdentifier: string;
  readonly dimension: string;
  readonly value: number;
  readonly expirationDate: string | null;
}

export interface EntitlementsData {
  readonly items: readonly EntitlementItem[];
  readonly meteredByDimension: Readonly<Record<string, number>>;
}

export async function loadEntitlements(identity: DbIdentity): Promise<EntitlementsData> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        id: marketplaceEntitlements.id,
        listingTitle: marketplaceListings.title,
        customerIdentifier: marketplaceEntitlements.customerIdentifier,
        dimension: marketplaceEntitlements.dimension,
        value: marketplaceEntitlements.value,
        expirationDate: marketplaceEntitlements.expirationDate,
      })
      .from(marketplaceEntitlements)
      .leftJoin(marketplaceListings, eq(marketplaceListings.id, marketplaceEntitlements.listingId))
      .where(eq(marketplaceEntitlements.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceEntitlements.createdAt));
    const metered = await tx
      .select({ dimension: marketplaceMeteringRecords.dimension, quantity: marketplaceMeteringRecords.quantity, status: marketplaceMeteringRecords.status })
      .from(marketplaceMeteringRecords)
      .where(eq(marketplaceMeteringRecords.tenantId, identity.tenantId));
    const meteredByDimension: Record<string, number> = {};
    for (const m of metered) {
      if (m.status !== "accepted") continue;
      meteredByDimension[m.dimension] = (meteredByDimension[m.dimension] ?? 0) + m.quantity;
    }
    return { items: rows, meteredByDimension };
  });
}

export interface AgreementItem {
  readonly id: string;
  readonly agreementId: string;
  readonly customerIdentifier: string;
  readonly offerType: string;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly totalValue: number;
}

export interface ChargeItem {
  readonly id: string;
  readonly agreementId: string;
  readonly period: string;
  readonly amount: number;
}

export interface BillingData {
  readonly agreements: readonly AgreementItem[];
  readonly charges: readonly ChargeItem[];
}

export async function loadBilling(identity: DbIdentity): Promise<BillingData> {
  return withTenant(identity, async (tx) => {
    const agreements = await tx
      .select()
      .from(marketplaceAgreements)
      .where(eq(marketplaceAgreements.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceAgreements.startDate));
    const charges = await tx
      .select()
      .from(marketplaceCharges)
      .where(eq(marketplaceCharges.tenantId, identity.tenantId));
    return {
      agreements: agreements.map((a) => ({
        id: a.id,
        agreementId: a.agreementId,
        customerIdentifier: a.customerIdentifier,
        offerType: a.offerType,
        status: a.status,
        startDate: a.startDate,
        endDate: a.endDate,
        totalValue: a.totalValue,
      })),
      charges: charges.map((c) => ({
        id: c.id,
        agreementId: c.agreementId,
        period: (c.billingPeriodStart ?? "").slice(0, 7),
        amount: c.amount,
      })),
    };
  });
}

export interface AgreementChargeDetail {
  readonly id: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly dimension: string;
  readonly quantity: number;
  readonly amount: number;
  readonly invoiceLineItem: string;
}

export interface AgreementDetail {
  readonly id: string;
  readonly agreementId: string;
  readonly customerIdentifier: string;
  readonly offerType: string;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly autoRenew: boolean;
  readonly totalValue: number;
  readonly acceptanceTime: Date | null;
  readonly listingId: string | null;
  readonly listingTitle: string | null;
  readonly charges: readonly AgreementChargeDetail[];
  readonly chargedTotal: number;
  /** Partner-drafted private offer reconciled onto this agreement, if any. */
  readonly offer: { id: string; title: string; status: string } | null;
}

/** One agreement (by row uuid) with its charge history and linked private offer. */
export async function loadAgreementDetail(
  identity: DbIdentity,
  id: string,
): Promise<AgreementDetail | null> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;
    const [a] = await tx
      .select({
        id: marketplaceAgreements.id,
        agreementId: marketplaceAgreements.agreementId,
        customerIdentifier: marketplaceAgreements.customerIdentifier,
        offerType: marketplaceAgreements.offerType,
        status: marketplaceAgreements.status,
        startDate: marketplaceAgreements.startDate,
        endDate: marketplaceAgreements.endDate,
        autoRenew: marketplaceAgreements.autoRenew,
        totalValue: marketplaceAgreements.totalValue,
        acceptanceTime: marketplaceAgreements.acceptanceTime,
        listingId: marketplaceAgreements.listingId,
        listingTitle: marketplaceListings.title,
      })
      .from(marketplaceAgreements)
      .leftJoin(marketplaceListings, eq(marketplaceListings.id, marketplaceAgreements.listingId))
      .where(and(eq(marketplaceAgreements.id, id), eq(marketplaceAgreements.tenantId, t)));
    if (!a) return null;

    // charges.agreement_id is the AWS TEXT identifier (not the row uuid) —
    // guard "" or every unref'd charge in the tenant would attach here.
    const charges =
      a.agreementId === ""
        ? []
        : await tx
            .select({
              id: marketplaceCharges.id,
              periodStart: marketplaceCharges.billingPeriodStart,
              periodEnd: marketplaceCharges.billingPeriodEnd,
              dimension: marketplaceCharges.dimension,
              quantity: marketplaceCharges.quantity,
              amount: marketplaceCharges.amount,
              invoiceLineItem: marketplaceCharges.invoiceLineItem,
            })
            .from(marketplaceCharges)
            .where(and(eq(marketplaceCharges.tenantId, t), eq(marketplaceCharges.agreementId, a.agreementId)))
            .orderBy(desc(marketplaceCharges.billingPeriodStart));

    const [offer] = await tx
      .select({
        id: marketplacePrivateOffers.id,
        title: marketplacePrivateOffers.title,
        status: marketplacePrivateOffers.status,
      })
      .from(marketplacePrivateOffers)
      .where(and(eq(marketplacePrivateOffers.tenantId, t), eq(marketplacePrivateOffers.agreementId, a.id)));

    return {
      ...a,
      charges,
      chargedTotal: charges.reduce((sum, c) => sum + c.amount, 0),
      offer: offer ?? null,
    };
  });
}

export interface RevenueAttribution {
  readonly awsService: string;
  readonly billingPeriod: string;
  readonly amount: number;
  readonly method: MarketplaceAttributionMethodId;
  readonly listingTitle: string | null;
}

export interface RevenueListingConfig {
  readonly listingId: string;
  readonly listingTitle: string;
  readonly configs: ReadonlyArray<{
    method: MarketplaceAttributionMethodId;
    enabled: boolean;
    status: MarketplaceAttributionStatusId;
  }>;
}

export interface RevenueData {
  readonly attributions: readonly RevenueAttribution[];
  readonly listings: ReadonlyArray<{ id: string; title: string }>;
  readonly byListing: readonly RevenueListingConfig[];
  readonly trend: ReadonlyArray<{ capturedOn: string; attributedRevenueCents: number }>;
}

export async function loadRevenue(identity: DbIdentity, today: string): Promise<RevenueData> {
  return withTenant(identity, async (tx) => {
    const attrRows = await tx
      .select({
        awsService: marketplaceAttributions.awsService,
        billingPeriod: marketplaceAttributions.billingPeriod,
        amount: marketplaceAttributions.amount,
        method: marketplaceAttributions.method,
        listingTitle: marketplaceListings.title,
      })
      .from(marketplaceAttributions)
      .leftJoin(marketplaceListings, eq(marketplaceListings.id, marketplaceAttributions.listingId))
      .where(eq(marketplaceAttributions.tenantId, identity.tenantId));

    const listings = await tx
      .select({ id: marketplaceListings.id, title: marketplaceListings.title })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceListings.createdAt));

    const configRows = await tx
      .select({
        listingId: marketplaceAttributionConfig.listingId,
        method: marketplaceAttributionConfig.method,
        enabled: marketplaceAttributionConfig.enabled,
        status: marketplaceAttributionConfig.status,
      })
      .from(marketplaceAttributionConfig)
      .where(eq(marketplaceAttributionConfig.tenantId, identity.tenantId));
    const configByListing = new Map<string, RevenueListingConfig["configs"][number][]>();
    for (const c of configRows) {
      const arr = configByListing.get(c.listingId) ?? [];
      arr.push({ method: c.method as MarketplaceAttributionMethodId, enabled: c.enabled, status: c.status as MarketplaceAttributionStatusId });
      configByListing.set(c.listingId, arr);
    }

    // The daily snapshot capture is NOT run here — the revenue page always
    // co-loads loadMarketplaceTrends, which owns the (deferred) capture; running
    // it in both loaders wrote the same row twice per view. Today's live value
    // is overlaid in memory so the sparkline still ends at "now".
    const attributedRevenueCents = attrRows.reduce((s, a) => s + a.amount, 0);
    const trendRows = await tx
      .select({ capturedOn: marketplaceRevenueSnapshots.capturedOn, attributedRevenueCents: marketplaceRevenueSnapshots.attributedRevenueCents })
      .from(marketplaceRevenueSnapshots)
      .where(eq(marketplaceRevenueSnapshots.tenantId, identity.tenantId))
      .orderBy(desc(marketplaceRevenueSnapshots.capturedOn))
      .limit(14);
    const trendWithToday =
      trendRows[0]?.capturedOn === today
        ? [{ ...trendRows[0], attributedRevenueCents }, ...trendRows.slice(1)]
        : [{ capturedOn: today, attributedRevenueCents }, ...trendRows].slice(0, 14);

    return {
      attributions: attrRows.map((a) => ({ ...a, method: a.method as MarketplaceAttributionMethodId })),
      listings,
      byListing: listings.map((l) => ({
        listingId: l.id,
        listingTitle: l.title,
        configs: configByListing.get(l.id) ?? [],
      })),
      trend: trendWithToday.reverse().map((t) => ({ capturedOn: t.capturedOn, attributedRevenueCents: t.attributedRevenueCents })),
    };
  });
}

export interface ListingDimension {
  readonly id: string;
  readonly apiName: string;
  readonly name: string;
  readonly unit: string;
  readonly price: number;
  readonly dimensionType: MarketplaceDimensionTypeId;
}

export interface ListingChangeSet {
  readonly id: string;
  readonly changeSetId: string;
  readonly intent: MarketplaceChangeIntentId;
  readonly status: MarketplaceChangeStatusId;
  readonly summary: string;
  readonly error: string;
  readonly createdAt: Date;
}

export interface ListingDetail {
  readonly id: string;
  readonly entityId: string;
  readonly productCode: string;
  readonly title: string;
  readonly description: string;
  readonly productType: MarketplaceProductTypeId;
  readonly visibility: MarketplaceVisibilityId;
  readonly status: MarketplaceListingStatusId;
  readonly solutionId: string | null;
  readonly solutionTitle: string | null;
  readonly lastSyncedAt: Date | null;
  readonly dimensions: readonly ListingDimension[];
  readonly changeSets: readonly ListingChangeSet[];
  /** The listing's own entitlements / recent metering / attributed revenue (unified workspace). */
  readonly entitlements: ReadonlyArray<{
    readonly id: string;
    readonly customerIdentifier: string;
    readonly dimension: string;
    readonly value: number;
    readonly expirationDate: string | null;
  }>;
  readonly recentMetering: ReadonlyArray<{
    readonly id: string;
    readonly dimension: string;
    readonly customerIdentifier: string;
    readonly quantity: number;
    readonly status: MeteringRecordStatus;
    readonly usageTimestamp: Date;
  }>;
  readonly attributedRevenueCents: number;
}

export async function loadListingDetail(identity: DbIdentity, id: string): Promise<ListingDetail | null> {
  return withTenant(identity, async (tx) => {
    const [row] = await tx
      .select()
      .from(marketplaceListings)
      .where(and(eq(marketplaceListings.id, id), eq(marketplaceListings.tenantId, identity.tenantId)));
    if (!row) return null;

    const dims = await tx
      .select()
      .from(marketplacePricingDimensions)
      .where(
        and(
          eq(marketplacePricingDimensions.listingId, id),
          eq(marketplacePricingDimensions.tenantId, identity.tenantId),
        ),
      )
      .orderBy(marketplacePricingDimensions.createdAt);

    const changes = await tx
      .select()
      .from(marketplaceChangeSets)
      .where(and(eq(marketplaceChangeSets.listingId, id), eq(marketplaceChangeSets.tenantId, identity.tenantId)))
      .orderBy(desc(marketplaceChangeSets.createdAt))
      .limit(20);

    const entitlementRows = await tx
      .select({
        id: marketplaceEntitlements.id,
        customerIdentifier: marketplaceEntitlements.customerIdentifier,
        dimension: marketplaceEntitlements.dimension,
        value: marketplaceEntitlements.value,
        expirationDate: marketplaceEntitlements.expirationDate,
      })
      .from(marketplaceEntitlements)
      .where(and(eq(marketplaceEntitlements.listingId, id), eq(marketplaceEntitlements.tenantId, identity.tenantId)))
      .orderBy(desc(marketplaceEntitlements.createdAt))
      .limit(8);

    const meteringRows = await tx
      .select({
        id: marketplaceMeteringRecords.id,
        dimension: marketplaceMeteringRecords.dimension,
        customerIdentifier: marketplaceMeteringRecords.customerIdentifier,
        quantity: marketplaceMeteringRecords.quantity,
        status: marketplaceMeteringRecords.status,
        usageTimestamp: marketplaceMeteringRecords.usageTimestamp,
      })
      .from(marketplaceMeteringRecords)
      .where(and(eq(marketplaceMeteringRecords.listingId, id), eq(marketplaceMeteringRecords.tenantId, identity.tenantId)))
      .orderBy(desc(marketplaceMeteringRecords.usageTimestamp))
      .limit(6);

    const [attr] = await tx
      .select({ cents: sql<number>`coalesce(sum(${marketplaceAttributions.amount}), 0)::int` })
      .from(marketplaceAttributions)
      .where(and(eq(marketplaceAttributions.listingId, id), eq(marketplaceAttributions.tenantId, identity.tenantId)));

    let solutionTitle: string | null = null;
    if (row.solutionId) {
      const [s] = await tx
        .select({ title: solutions.title })
        .from(solutions)
        .where(eq(solutions.id, row.solutionId));
      solutionTitle = s?.title ?? null;
    }

    return {
      id: row.id,
      entityId: row.entityId,
      productCode: row.productCode,
      title: row.title,
      description: row.description,
      productType: row.productType as MarketplaceProductTypeId,
      visibility: row.visibility as MarketplaceVisibilityId,
      status: row.status as MarketplaceListingStatusId,
      solutionId: row.solutionId,
      solutionTitle,
      lastSyncedAt: row.lastSyncedAt,
      dimensions: dims.map((d) => ({
        id: d.id,
        apiName: d.apiName,
        name: d.name,
        unit: d.unit,
        price: d.price,
        dimensionType: d.dimensionType as MarketplaceDimensionTypeId,
      })),
      changeSets: changes.map((c) => ({
        id: c.id,
        changeSetId: c.changeSetId,
        intent: c.intent as MarketplaceChangeIntentId,
        status: c.status as MarketplaceChangeStatusId,
        summary: typeof c.payload?.summary === "string" ? c.payload.summary : c.intent,
        error: c.error,
        createdAt: c.createdAt,
      })),
      entitlements: entitlementRows,
      recentMetering: meteringRows.map((r) => ({ ...r, status: r.status as MeteringRecordStatus })),
      attributedRevenueCents: attr?.cents ?? 0,
    };
  });
}

/**
 * Per-listing rollup powering the Command Center + notification-bell marketplace signals:
 * published flag, entitlement expiry counts (status derived here so signals.ts stays
 * clock-free), failed change sets, accepted-metering count, and attributed revenue. Takes
 * the caller's RLS transaction so command/load + notifications/load share one round trip.
 */
export async function marketplaceCommandRollup(
  tx: MutationContext["tx"],
  tenantId: string,
  today: string,
): Promise<CommandMarketplaceListing[]> {
  const listings = await tx
    .select({ id: marketplaceListings.id, title: marketplaceListings.title, status: marketplaceListings.status })
    .from(marketplaceListings)
    .where(eq(marketplaceListings.tenantId, tenantId));
  if (listings.length === 0) return [];

  const failedRows = await tx
    .select({ listingId: marketplaceChangeSets.listingId, n: sql<number>`count(*)::int` })
    .from(marketplaceChangeSets)
    .where(and(eq(marketplaceChangeSets.tenantId, tenantId), eq(marketplaceChangeSets.status, "failed")))
    .groupBy(marketplaceChangeSets.listingId);
  const failedByListing = new Map(failedRows.map((r) => [r.listingId, r.n] as const));

  const entRows = await tx
    .select({ listingId: marketplaceEntitlements.listingId, expirationDate: marketplaceEntitlements.expirationDate })
    .from(marketplaceEntitlements)
    .where(eq(marketplaceEntitlements.tenantId, tenantId));
  const expiring = new Map<string, number>();
  const expired = new Map<string, number>();
  for (const e of entRows) {
    if (!e.listingId) continue;
    const status = entitlementStatus(e.expirationDate, today);
    if (status === "expiring") expiring.set(e.listingId, (expiring.get(e.listingId) ?? 0) + 1);
    else if (status === "expired") expired.set(e.listingId, (expired.get(e.listingId) ?? 0) + 1);
  }

  const usageRows = await tx
    .select({ listingId: marketplaceMeteringRecords.listingId, n: sql<number>`count(*)::int` })
    .from(marketplaceMeteringRecords)
    .where(and(eq(marketplaceMeteringRecords.tenantId, tenantId), eq(marketplaceMeteringRecords.status, "accepted")))
    .groupBy(marketplaceMeteringRecords.listingId);
  const usageByListing = new Map(usageRows.map((r) => [r.listingId, r.n] as const));

  const attrRows = await tx
    .select({
      listingId: marketplaceAttributions.listingId,
      cents: sql<number>`coalesce(sum(${marketplaceAttributions.amount}), 0)::int`,
    })
    .from(marketplaceAttributions)
    .where(eq(marketplaceAttributions.tenantId, tenantId))
    .groupBy(marketplaceAttributions.listingId);
  const attrByListing = new Map<string, number>();
  for (const a of attrRows) {
    if (a.listingId) attrByListing.set(a.listingId, a.cents);
  }

  return listings.map((l) => ({
    id: l.id,
    title: l.title,
    published: l.status === "published",
    expiringEntitlements: expiring.get(l.id) ?? 0,
    expiredEntitlements: expired.get(l.id) ?? 0,
    failedChangeSets: failedByListing.get(l.id) ?? 0,
    acceptedUsageCount: usageByListing.get(l.id) ?? 0,
    attributedRevenueCents: attrByListing.get(l.id) ?? 0,
  }));
}

/** Per-customer rollup across entitlements / agreements / metering (+ resolved AWS account). */
export async function loadCustomers(identity: DbIdentity, today: string): Promise<CustomerRollup[]> {
  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;
    const entitlements = await tx
      .select({
        customerIdentifier: marketplaceEntitlements.customerIdentifier,
        expirationDate: marketplaceEntitlements.expirationDate,
      })
      .from(marketplaceEntitlements)
      .where(eq(marketplaceEntitlements.tenantId, t));
    const agreements = await tx
      .select({
        customerIdentifier: marketplaceAgreements.customerIdentifier,
        totalValue: marketplaceAgreements.totalValue,
      })
      .from(marketplaceAgreements)
      .where(eq(marketplaceAgreements.tenantId, t));
    const metering = await tx
      .select({
        customerIdentifier: marketplaceMeteringRecords.customerIdentifier,
        quantity: marketplaceMeteringRecords.quantity,
        status: marketplaceMeteringRecords.status,
        usageTimestamp: marketplaceMeteringRecords.usageTimestamp,
      })
      .from(marketplaceMeteringRecords)
      .where(eq(marketplaceMeteringRecords.tenantId, t));
    const directory = await tx
      .select({
        customerIdentifier: marketplaceCustomers.customerIdentifier,
        customerAwsAccountId: marketplaceCustomers.customerAwsAccountId,
      })
      .from(marketplaceCustomers)
      .where(eq(marketplaceCustomers.tenantId, t));
    return rollupCustomers({ entitlements, agreements, metering, directory }, today);
  });
}
