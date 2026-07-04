import { and, eq, sql } from "drizzle-orm";
import type { MutationContext } from "@/gate/mutation-gate";
import {
  awsConnection,
  marketplaceChangeSets,
  marketplaceListings,
  marketplacePricingDimensions,
  marketplaceMeteringRecords,
  marketplaceCustomers,
  marketplaceEntitlements,
  marketplaceAgreements,
  marketplaceCharges,
  marketplaceAttributionConfig,
  marketplaceRevenueSnapshots,
  solutions,
} from "@/db/schema";
import type { MarketplaceAttributionMethodId } from "@/domain/marketplace/catalog";
import type { MeteringResultRow, EntitlementRow, AgreementRow, MarketplaceChangeStatusId } from "@/domain/marketplace/mapping";
import type { AgreementChargeRow } from "@/aws/marketplace";
import { ValidationError } from "@/http/errors";
import { reconcilePrivateOffersOp } from "@/domain/marketplace/offer-operations";
import type { ListingRow } from "@/domain/marketplace/mapping";
import { changeSummary, type ListingLike, type DimensionLike, publishReadiness } from "@/domain/marketplace/changeset";
import type {
  MarketplaceChangeIntentId,
  MarketplaceDimensionTypeId,
  MarketplaceProductTypeId,
  MarketplaceVisibilityId,
} from "@/domain/marketplace/catalog";

/**
 * The database side of AWS Marketplace. AWS is the source of truth: sync ops upsert the
 * mirror tables from the AWS APIs, write-through ops (ChangeSets / metering) record the
 * AWS call result locally. Factored out of the actions so the gate drives them in tests.
 * Marketplace reuses the per-tenant awsConnection row (assumed via STS); the role config
 * is shared with the Partner Central connector but the two toggle independently.
 */

const ROLE_ARN_RE = /^arn:aws:iam::\d{12}:role\/.+$/;

export interface MarketplaceConnectionInput {
  readonly roleArn: string;
  readonly externalId: string;
  readonly region: string;
  readonly sellerId: string;
  readonly enabled: boolean;
}

/** Validate + upsert the Marketplace side of the per-tenant AWS connection. Gated. */
export async function saveMarketplaceConnectionOp(
  { identity, tx }: MutationContext,
  input: MarketplaceConnectionInput,
): Promise<{ id: string }> {
  if (input.enabled) {
    if (!ROLE_ARN_RE.test(input.roleArn)) {
      throw new ValidationError("Enter a valid IAM role ARN (arn:aws:iam::<account-id>:role/<name>).");
    }
    if (!input.externalId.trim()) {
      throw new ValidationError("An external ID is required to enable the connection.");
    }
  }

  const region = input.region || "us-east-1";
  const marketplaceStatus = input.enabled ? "configured" : "disabled";
  await tx
    .insert(awsConnection)
    .values({
      tenantId: identity.tenantId,
      roleArn: input.roleArn,
      externalId: input.externalId,
      region,
      marketplaceEnabled: input.enabled,
      sellerId: input.sellerId,
      marketplaceStatus,
    })
    .onConflictDoUpdate({
      target: awsConnection.tenantId,
      // Only touch the shared role config + the Marketplace fields -- never clobber the
      // Partner Central toggle/catalog/status on the same row.
      set: {
        roleArn: input.roleArn,
        externalId: input.externalId,
        region,
        marketplaceEnabled: input.enabled,
        sellerId: input.sellerId,
        marketplaceStatus,
        updatedAt: sql`now()`,
      },
    });
  return { id: identity.tenantId };
}

/** Upsert listings synced from the Catalog API (AWS is the source of truth). Idempotent. */
export async function syncListingsOp(
  { identity, tx }: MutationContext,
  rows: readonly ListingRow[],
): Promise<{ count: number }> {
  for (const r of rows) {
    // Mirror status from AWS visibility: public/restricted listings are live; limited = draft.
    const status = r.visibility === "limited" ? "draft" : "published";
    await tx
      .insert(marketplaceListings)
      .values({
        tenantId: identity.tenantId,
        entityId: r.entityId,
        title: r.title,
        productType: r.productType,
        visibility: r.visibility,
        status,
        lastSyncedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [marketplaceListings.tenantId, marketplaceListings.entityId],
        // Never clobber locally-managed links (solution, description) on a sync.
        set: {
          title: r.title,
          productType: r.productType,
          visibility: r.visibility,
          status,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
  return { count: rows.length };
}

export interface CreateListingInput {
  readonly title: string;
  readonly productType: MarketplaceProductTypeId;
  readonly description: string;
}

/**
 * Create a local draft listing. A draft exists in PartnerOS before its first ChangeSet
 * pushes it to AWS, so it gets a local entity id (entity:local:<id>) until a sync replaces
 * it with the AWS-assigned id.
 */
export async function createListingDraftOp(
  { identity, tx }: MutationContext,
  input: CreateListingInput,
): Promise<{ id: string }> {
  if (!input.title.trim()) throw new ValidationError("A product title is required.");
  const [row] = await tx
    .insert(marketplaceListings)
    .values({
      tenantId: identity.tenantId,
      entityId: `entity:local:${crypto.randomUUID()}`,
      title: input.title.trim(),
      productType: input.productType,
      description: input.description.trim(),
      visibility: "limited",
      status: "draft",
      createdBy: identity.userId,
    })
    .returning({ id: marketplaceListings.id });
  return { id: row!.id };
}

async function loadListingForEdit(
  ctx: MutationContext,
  listingId: string,
): Promise<{ id: string; title: string; description: string; status: string }> {
  const [row] = await ctx.tx
    .select({
      id: marketplaceListings.id,
      title: marketplaceListings.title,
      description: marketplaceListings.description,
      status: marketplaceListings.status,
    })
    .from(marketplaceListings)
    .where(and(eq(marketplaceListings.id, listingId), eq(marketplaceListings.tenantId, ctx.identity.tenantId)));
  if (!row) throw new ValidationError("Listing not found");
  return row;
}

export interface AddDimensionInput {
  readonly listingId: string;
  readonly apiName: string;
  readonly name: string;
  readonly unit: string;
  readonly price: number; // integer cents
  readonly dimensionType: MarketplaceDimensionTypeId;
}

/** Add a pricing dimension to a listing and record an add_dimension change set. */
export async function addPricingDimensionOp(
  ctx: MutationContext,
  input: AddDimensionInput,
  change: ChangeApplication,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  await loadListingForEdit(ctx, input.listingId);
  if (input.price < 0) throw new ValidationError("Price cannot be negative.");
  const apiName = input.apiName.trim() || input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const [row] = await tx
    .insert(marketplacePricingDimensions)
    .values({
      tenantId: identity.tenantId,
      listingId: input.listingId,
      apiName,
      name: input.name.trim(),
      unit: input.unit,
      price: input.price,
      dimensionType: input.dimensionType,
    })
    .onConflictDoUpdate({
      target: [
        marketplacePricingDimensions.tenantId,
        marketplacePricingDimensions.listingId,
        marketplacePricingDimensions.apiName,
      ],
      set: { name: input.name.trim(), unit: input.unit, price: input.price, dimensionType: input.dimensionType, updatedAt: sql`now()` },
    })
    .returning({ id: marketplacePricingDimensions.id });
  await recordChangeSet(ctx, input.listingId, "add_dimension", { name: input.name.trim(), apiName, price: input.price }, change);
  return { id: row!.id };
}

/** How the AWS call resolved: a real ChangeSet (connected) or a local-only edit (dev). */
export interface ChangeApplication {
  readonly changeSetId: string;
  readonly status: "preparing" | "applying" | "succeeded" | "failed";
  readonly error?: string;
}

async function recordChangeSet(
  { identity, tx }: MutationContext,
  listingId: string | null,
  intent: MarketplaceChangeIntentId,
  payload: Record<string, unknown>,
  change: ChangeApplication,
): Promise<void> {
  const terminal = change.status === "succeeded" || change.status === "failed";
  await tx.insert(marketplaceChangeSets).values({
    tenantId: identity.tenantId,
    listingId,
    changeSetId: change.changeSetId,
    intent,
    status: change.status,
    payload: { ...payload, summary: changeSummary(intent, payload) },
    error: change.error ?? "",
    startedAt: sql`now()`,
    endedAt: terminal ? sql`now()` : null,
    createdBy: identity.userId,
  });
}

export interface ApplyChangeInput {
  readonly listingId: string;
  readonly intent: Extract<MarketplaceChangeIntentId, "update_details" | "update_visibility" | "publish">;
  readonly title?: string;
  readonly description?: string;
  readonly visibility?: MarketplaceVisibilityId;
}

/**
 * Apply a listing edit to the mirror and record the change set. For a connected tenant the
 * action has already called StartChangeSet (passing the AWS id + status in `change`); when
 * disconnected the edit is local-only. Publish requires the listing to pass publishReadiness.
 */
export async function applyListingChangeOp(
  ctx: MutationContext,
  input: ApplyChangeInput,
  change: ChangeApplication,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  const listing = await loadListingForEdit(ctx, input.listingId);

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  const payload: Record<string, unknown> = {};
  if (input.intent === "update_details") {
    if (input.title !== undefined) {
      set.title = input.title.trim();
      payload.title = input.title.trim();
    }
    if (input.description !== undefined) {
      set.description = input.description.trim();
      payload.description = input.description.trim();
    }
  } else if (input.intent === "update_visibility" && input.visibility) {
    set.visibility = input.visibility;
    payload.visibility = input.visibility;
  } else if (input.intent === "publish") {
    const dims = await tx
      .select({ apiName: marketplacePricingDimensions.apiName, name: marketplacePricingDimensions.name, price: marketplacePricingDimensions.price })
      .from(marketplacePricingDimensions)
      .where(
        and(
          eq(marketplacePricingDimensions.listingId, input.listingId),
          eq(marketplacePricingDimensions.tenantId, identity.tenantId),
        ),
      );
    const check = publishReadiness(listing as ListingLike, dims as DimensionLike[]);
    if (!check.ready) throw new ValidationError(check.issues.join(" "));
    set.status = "published";
    set.visibility = "public";
    payload.publish = true;
  }

  await tx
    .update(marketplaceListings)
    .set(set)
    .where(and(eq(marketplaceListings.id, input.listingId), eq(marketplaceListings.tenantId, identity.tenantId)));
  await recordChangeSet(ctx, input.listingId, input.intent, payload, change);
  return { id: input.listingId };
}

export interface SubmitMeteringInput {
  readonly listingId: string;
  readonly dimension: string;
  readonly customerIdentifier: string;
  readonly quantity: number;
}

/**
 * Record a usage submission. The action has already called BatchMeterUsage on AWS (or, when
 * disconnected, marked it locally accepted); `result` carries the per-record outcome.
 */
export async function submitMeteringOp(
  ctx: MutationContext,
  input: SubmitMeteringInput,
  result: MeteringResultRow,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  await loadListingForEdit(ctx, input.listingId);
  if (input.quantity < 0) throw new ValidationError("Quantity cannot be negative.");
  const [row] = await tx
    .insert(marketplaceMeteringRecords)
    .values({
      tenantId: identity.tenantId,
      listingId: input.listingId,
      dimension: input.dimension,
      customerIdentifier: input.customerIdentifier,
      quantity: input.quantity,
      status: result.status,
      meteringRecordId: result.meteringRecordId,
      result: result.status === "accepted" ? "Success" : "Rejected",
      createdBy: identity.userId,
    })
    .returning({ id: marketplaceMeteringRecords.id });
  return { id: row!.id };
}

export interface ResubmitMeteringItem {
  /** The rejected record being retried. */
  readonly sourceId: string;
  readonly listingId: string;
  /** Outcome of the retry the action already sent to AWS (or accepted locally). */
  readonly result: MeteringResultRow;
}

/**
 * Record a bulk retry of rejected usage records. Each retry inserts a NEW
 * record carrying the fresh AWS outcome; the source row keeps its rejected
 * status (honest history) and is annotated result='Resubmitted', which is
 * what blocks a double-resubmit. Sources that are no longer eligible inside
 * the transaction (already annotated, not rejected, or another tenant's row)
 * are skipped, not failed — the bulk keeps going.
 */
export async function resubmitMeteringOp(
  ctx: MutationContext,
  items: readonly ResubmitMeteringItem[],
): Promise<{ resubmitted: number }> {
  const { identity, tx } = ctx;
  let resubmitted = 0;
  for (const item of items) {
    // Claim the source row first: the UPDATE's guard re-checks eligibility
    // under the tx so a concurrent resubmit can't double-insert.
    const claimed = await tx
      .update(marketplaceMeteringRecords)
      .set({ result: "Resubmitted", updatedAt: sql`now()` })
      .where(
        and(
          eq(marketplaceMeteringRecords.id, item.sourceId),
          eq(marketplaceMeteringRecords.tenantId, identity.tenantId),
          eq(marketplaceMeteringRecords.status, "rejected"),
          sql`${marketplaceMeteringRecords.result} <> 'Resubmitted'`,
        ),
      )
      .returning({ id: marketplaceMeteringRecords.id });
    if (claimed.length === 0) continue;

    await tx.insert(marketplaceMeteringRecords).values({
      tenantId: identity.tenantId,
      listingId: item.listingId,
      dimension: item.result.dimension,
      customerIdentifier: item.result.customerIdentifier,
      quantity: item.result.quantity,
      status: item.result.status,
      meteringRecordId: item.result.meteringRecordId,
      result: item.result.status === "accepted" ? "Success" : "Rejected",
      createdBy: identity.userId,
    });
    resubmitted += 1;
  }
  return { resubmitted };
}

export interface ResolveCustomerInput {
  readonly customerIdentifier: string;
  readonly customerAwsAccountId: string;
  readonly productCode: string;
  readonly listingId: string | null;
}

/** Upsert a resolved Marketplace customer (from ResolveCustomer). Idempotent. */
export async function resolveCustomerOp(
  { identity, tx }: MutationContext,
  input: ResolveCustomerInput,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(marketplaceCustomers)
    .values({
      tenantId: identity.tenantId,
      customerIdentifier: input.customerIdentifier,
      customerAwsAccountId: input.customerAwsAccountId,
      productCode: input.productCode,
      listingId: input.listingId,
    })
    .onConflictDoUpdate({
      target: [marketplaceCustomers.tenantId, marketplaceCustomers.customerIdentifier],
      set: {
        customerAwsAccountId: input.customerAwsAccountId,
        productCode: input.productCode,
        listingId: input.listingId,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: marketplaceCustomers.id });
  return { id: row!.id };
}

/** Resolve a productCode -> listingId map for the tenant (to link synced mirror rows). */
async function listingByProductCode(ctx: MutationContext): Promise<Map<string, string>> {
  const rows = await ctx.tx
    .select({ id: marketplaceListings.id, productCode: marketplaceListings.productCode })
    .from(marketplaceListings)
    .where(eq(marketplaceListings.tenantId, ctx.identity.tenantId));
  const m = new Map<string, string>();
  for (const r of rows) if (r.productCode) m.set(r.productCode, r.id);
  return m;
}

/** Upsert entitlements synced from the Entitlement API (GetEntitlements). Idempotent. */
export async function syncEntitlementsOp(
  ctx: MutationContext,
  rows: readonly EntitlementRow[],
): Promise<{ count: number }> {
  const { identity, tx } = ctx;
  const byCode = await listingByProductCode(ctx);
  for (const r of rows) {
    await tx
      .insert(marketplaceEntitlements)
      .values({
        tenantId: identity.tenantId,
        entitlementId: r.entitlementRef,
        listingId: byCode.get(r.productCode) ?? null,
        customerIdentifier: r.customerIdentifier,
        dimension: r.dimension,
        value: r.value,
        expirationDate: r.expirationDate,
        lastSyncedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [marketplaceEntitlements.tenantId, marketplaceEntitlements.entitlementId],
        set: {
          listingId: byCode.get(r.productCode) ?? null,
          customerIdentifier: r.customerIdentifier,
          dimension: r.dimension,
          value: r.value,
          expirationDate: r.expirationDate,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
  return { count: rows.length };
}

/** Upsert agreements + their charges synced from the Agreement API. Idempotent. */
export async function syncBillingOp(
  { identity, tx }: MutationContext,
  agreements: readonly AgreementRow[],
  charges: readonly AgreementChargeRow[],
): Promise<{ agreements: number; charges: number }> {
  for (const a of agreements) {
    await tx
      .insert(marketplaceAgreements)
      .values({
        tenantId: identity.tenantId,
        agreementId: a.agreementId,
        customerIdentifier: a.customerIdentifier,
        offerType: a.offerType,
        status: a.status,
        startDate: a.startDate,
        endDate: a.endDate,
        acceptanceTime: a.acceptanceTime,
        lastSyncedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [marketplaceAgreements.tenantId, marketplaceAgreements.agreementId],
        set: {
          customerIdentifier: a.customerIdentifier,
          offerType: a.offerType,
          status: a.status,
          startDate: a.startDate,
          endDate: a.endDate,
          acceptanceTime: a.acceptanceTime,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
  for (const c of charges) {
    const start = c.time || null;
    await tx
      .insert(marketplaceCharges)
      .values({
        tenantId: identity.tenantId,
        chargeRef: c.chargeId,
        agreementId: c.agreementId,
        billingPeriodStart: start,
        billingPeriodEnd: start,
        amount: c.amountCents,
      })
      .onConflictDoUpdate({
        target: [marketplaceCharges.tenantId, marketplaceCharges.chargeRef],
        set: { agreementId: c.agreementId, billingPeriodStart: start, billingPeriodEnd: start, amount: c.amountCents, updatedAt: sql`now()` },
      });
  }
  // Bridge: reconcile any SENT co-sell private offers onto the agreements just synced —
  // a matching customer/listing agreement accepts + links the offer to the transaction.
  await reconcilePrivateOffersOp({ identity, tx });
  return { agreements: agreements.length, charges: charges.length };
}

export interface AttributionMethodInput {
  readonly listingId: string;
  readonly method: MarketplaceAttributionMethodId;
  readonly enabled: boolean;
  readonly notes: string;
}

/** Configure one PRM attribution method for a listing (partner-managed). Idempotent. */
export async function configureAttributionMethodOp(
  ctx: MutationContext,
  input: AttributionMethodInput,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  await loadListingForEdit(ctx, input.listingId);
  const status = input.enabled ? "active" : "inactive";
  const [row] = await tx
    .insert(marketplaceAttributionConfig)
    .values({
      tenantId: identity.tenantId,
      listingId: input.listingId,
      method: input.method,
      enabled: input.enabled,
      status,
      notes: input.notes,
      createdBy: identity.userId,
    })
    .onConflictDoUpdate({
      target: [
        marketplaceAttributionConfig.tenantId,
        marketplaceAttributionConfig.listingId,
        marketplaceAttributionConfig.method,
      ],
      set: { enabled: input.enabled, status, notes: input.notes, updatedAt: sql`now()` },
    })
    .returning({ id: marketplaceAttributionConfig.id });
  return { id: row!.id };
}

export interface MarketplaceSnapshotValues {
  readonly listings: number;
  readonly published: number;
  readonly activeEntitlements: number;
  readonly meteredUsageCents: number;
  readonly attributedRevenueCents: number;
  readonly mrrCents: number;
}

/** Capture-on-read daily revenue snapshot (best-effort, idempotent by tenant+day). */
export async function captureMarketplaceSnapshot(
  { identity, tx }: MutationContext,
  input: { readonly capturedOn: string; readonly values: MarketplaceSnapshotValues },
): Promise<{ capturedOn: string }> {
  await tx
    .insert(marketplaceRevenueSnapshots)
    .values({ tenantId: identity.tenantId, capturedOn: input.capturedOn, ...input.values })
    .onConflictDoUpdate({
      target: [marketplaceRevenueSnapshots.tenantId, marketplaceRevenueSnapshots.capturedOn],
      set: { ...input.values, updatedAt: sql`now()` },
    });
  return { capturedOn: input.capturedOn };
}

/** Mark a change set failed locally (used when StartChangeSet/AWS errors before tracking). */
export async function failChangeSetOp(
  { identity, tx }: MutationContext,
  input: { readonly changeSetRowId: string; readonly error: string },
): Promise<{ id: string }> {
  const updated = await tx
    .update(marketplaceChangeSets)
    .set({ status: "failed", error: input.error.slice(0, 1000), endedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(marketplaceChangeSets.id, input.changeSetRowId),
        eq(marketplaceChangeSets.tenantId, identity.tenantId),
      ),
    )
    .returning({ id: marketplaceChangeSets.id });
  if (updated.length === 0) throw new ValidationError("Change set not found");
  return { id: input.changeSetRowId };
}

export interface LinkSolutionInput {
  readonly listingId: string;
  readonly solutionId: string | null;
}

/**
 * Link a listing to a tenant Solution (or unlink with solutionId=null). Asserts both rows
 * belong to the tenant. `solution_id` is locally managed — sync never clobbers it.
 */
export async function linkListingToSolutionOp(
  { identity, tx }: MutationContext,
  input: LinkSolutionInput,
): Promise<{ id: string }> {
  if (input.solutionId) {
    const [sol] = await tx
      .select({ id: solutions.id })
      .from(solutions)
      .where(and(eq(solutions.id, input.solutionId), eq(solutions.tenantId, identity.tenantId)));
    if (!sol) throw new ValidationError("Solution not found");
  }
  const updated = await tx
    .update(marketplaceListings)
    .set({ solutionId: input.solutionId, updatedAt: sql`now()` })
    .where(and(eq(marketplaceListings.id, input.listingId), eq(marketplaceListings.tenantId, identity.tenantId)))
    .returning({ id: marketplaceListings.id });
  if (updated.length === 0) throw new ValidationError("Listing not found");
  return { id: input.listingId };
}

/**
 * Refresh one change set's status from AWS (DescribeChangeSet, mapped). The action makes the
 * AWS call; this records the new status + sets endedAt once it reaches a terminal state. A
 * failed change set surfaces in change history and drives the marketplace_changeset signal.
 */
export async function refreshChangeSetOp(
  { identity, tx }: MutationContext,
  input: { readonly changeSetRowId: string; readonly status: MarketplaceChangeStatusId; readonly error: string },
): Promise<{ id: string; status: MarketplaceChangeStatusId }> {
  const terminal = input.status === "succeeded" || input.status === "failed" || input.status === "cancelled";
  const updated = await tx
    .update(marketplaceChangeSets)
    .set({
      status: input.status,
      error: input.error.slice(0, 1000),
      endedAt: terminal ? sql`now()` : null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(marketplaceChangeSets.id, input.changeSetRowId), eq(marketplaceChangeSets.tenantId, identity.tenantId)))
    .returning({ id: marketplaceChangeSets.id });
  if (updated.length === 0) throw new ValidationError("Change set not found");
  return { id: input.changeSetRowId, status: input.status };
}
