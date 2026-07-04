"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { runMutation } from "@/gate/mutation-gate";
import { withTenant } from "@/db/client";
import { awsConnection, marketplaceListings, marketplaceMeteringRecords } from "@/db/schema";
import { getServerIdentity, type ServerIdentity } from "@/auth/session";
import { AppError } from "@/http/errors";
import { type ActionState } from "@/domain/forms";
import {
  saveMarketplaceConnectionOp,
  syncListingsOp,
  createListingDraftOp,
  addPricingDimensionOp,
  applyListingChangeOp,
  type ChangeApplication,
} from "@/domain/marketplace/operations";
import {
  listMarketplaceEntities,
  startMarketplaceChangeSet,
  batchMeterMarketplaceUsage,
  getMarketplaceEntitlements,
  searchMarketplaceAgreements,
  listMarketplaceAgreementCharges,
  describeMarketplaceChangeSet,
  type MarketplaceConfig,
  type AgreementChargeRow,
} from "@/aws/marketplace";
import {
  mapEntityToListing,
  mapUsageResult,
  mapEntitlement,
  mapAgreement,
  changeStatusFromAws,
  type ListingRow,
  type MeteringResultRow,
  type EntitlementRow,
  type AgreementRow,
  type MarketplaceChangeStatusId,
} from "@/domain/marketplace/mapping";
import {
  submitMeteringOp,
  resubmitMeteringOp,
  syncEntitlementsOp,
  syncBillingOp,
  configureAttributionMethodOp,
  linkListingToSolutionOp,
  refreshChangeSetOp,
  type ResubmitMeteringItem,
} from "@/domain/marketplace/operations";
import { chunk } from "@/domain/marketplace/metering";
import { parseBulkIds } from "@/domain/bulk";
import type { MarketplaceAttributionMethodId } from "@/domain/marketplace/catalog";
import { awsChangeType, buildChangeDetails } from "@/domain/marketplace/changeset";
import type {
  MarketplaceChangeIntentId,
  MarketplaceDimensionTypeId,
  MarketplaceProductTypeId,
  MarketplaceVisibilityId,
} from "@/domain/marketplace/catalog";

/**
 * AWS Marketplace server actions. The connection save is gated like the Partner Central
 * one (the role ARN + external id are not high-value on their own; the external id is
 * logged only by length). Sync / change-set / metering actions are added per pillar and
 * follow the two-phase pattern: the AWS call runs OUTSIDE the gate, the mirror write goes
 * through the gate (audit + RLS).
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function field(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Save the Marketplace side of the per-tenant AWS connection. Gated. */
export async function saveMarketplaceConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const roleArn = field(formData.get("roleArn"));
    const externalId = field(formData.get("externalId"));
    const region = field(formData.get("region")) || "us-east-1";
    const sellerId = field(formData.get("sellerId"));
    const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      // The external id is a shared secret -- log only its length, never the value.
      rawBody: JSON.stringify({ roleArn, region, sellerId, enabled, externalIdLen: externalId.length }),
      action: "settings.save_marketplace_connection",
      resourceType: "aws_connection",
      auditMetadata: { enabled, region, sellerId },
      handler: (ctx) => saveMarketplaceConnectionOp(ctx, { roleArn, externalId, region, sellerId, enabled }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Listings -- AWS is the source of truth. Sync reads the Catalog API; edits are
// written through as Catalog ChangeSets when connected and applied to the local
// mirror. When the connection is disabled the edit is local-only (dev/demo).
// ---------------------------------------------------------------------------

const AWS_ENTITY_TYPE: Record<MarketplaceProductTypeId, string> = {
  saas: "SaaSProduct",
  ami: "AmiProduct",
  container: "ContainerProduct",
  machine_learning: "MachineLearningProduct",
  professional_services: "ProfessionalServicesProduct",
};

async function marketplaceConfig(
  identity: ServerIdentity,
): Promise<{ cfg: MarketplaceConfig; enabled: boolean } | null> {
  const [c] = await withTenant(identity, (tx) =>
    tx.select().from(awsConnection).where(eq(awsConnection.tenantId, identity.tenantId)),
  );
  if (!c) return null;
  return {
    enabled: c.marketplaceEnabled,
    cfg: {
      tenantId: identity.tenantId,
      roleArn: c.roleArn,
      externalId: c.externalId,
      region: c.region,
      catalog: "AWSMarketplace",
      sellerId: c.sellerId,
    },
  };
}

async function stampMarketplaceError(identity: ServerIdentity, message: string): Promise<void> {
  await withTenant(identity, (tx) =>
    tx
      .update(awsConnection)
      .set({ marketplaceStatus: "error", marketplaceLastError: message.slice(0, 300), updatedAt: sql`now()` })
      .where(eq(awsConnection.tenantId, identity.tenantId)),
  ).catch(() => undefined);
}

/** Sync listings from the AWS Catalog API into the mirror (two-phase). Gated. */
export async function syncListings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in to sync." };
  const conn = await marketplaceConfig(identity);
  if (!conn || !conn.enabled) {
    return { ok: false, error: "Configure and enable the AWS Marketplace connection in Settings -> Integrations first." };
  }

  let rows: ListingRow[];
  try {
    const entities = await listMarketplaceEntities(conn.cfg);
    rows = entities.map(mapEntityToListing).filter((r): r is ListingRow => r !== null);
  } catch (err) {
    await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
    return { ok: false, error: "AWS Marketplace sync failed -- check the connection and try again." };
  }

  try {
    await runMutation({
      permission: "marketplace:sync",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ count: rows.length }),
      action: "marketplace.sync_listings",
      resourceType: "marketplace_listings",
      auditMetadata: { count: rows.length },
      handler: (ctx) => syncListingsOp(ctx, rows),
    });
    await withTenant(identity, (tx) =>
      tx
        .update(awsConnection)
        .set({ marketplaceStatus: "configured", marketplaceLastError: null, marketplaceLastSyncedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(awsConnection.tenantId, identity.tenantId)),
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace");
  return { ok: true };
}

/** Create a local draft listing (no AWS call -- a draft precedes its first ChangeSet). */
export async function createListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let id = "";
  try {
    const title = field(formData.get("title"));
    const productType = (field(formData.get("productType")) || "saas") as MarketplaceProductTypeId;
    const description = field(formData.get("description"));
    const res = await runMutation({
      permission: "marketplace:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ title, productType }),
      action: "marketplace.create_listing",
      resourceType: "marketplace_listing",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => createListingDraftOp(ctx, { title, productType, description }),
    });
    id = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace");
  redirect(`/marketplace/${id}`);
}

/**
 * Resolve a change against AWS: when connected, StartChangeSet returns an id + "applying";
 * when disabled, the edit is applied locally ("succeeded"). Throws on an AWS error so the
 * caller surfaces it without mutating the mirror.
 */
async function resolveChange(
  identity: ServerIdentity,
  intent: MarketplaceChangeIntentId,
  entityId: string,
  productType: MarketplaceProductTypeId,
  payload: Record<string, unknown>,
): Promise<ChangeApplication> {
  const conn = await marketplaceConfig(identity);
  if (!conn || !conn.enabled) return { changeSetId: "", status: "succeeded" };
  const res = await startMarketplaceChangeSet(conn.cfg, `partneros-${intent}`, [
    {
      changeType: awsChangeType(intent),
      entityType: AWS_ENTITY_TYPE[productType],
      entityIdentifier: entityId,
      details: buildChangeDetails(intent, payload),
    },
  ]);
  return { changeSetId: res.changeSetId, status: "applying" };
}

async function listingAws(
  identity: ServerIdentity,
  listingId: string,
): Promise<{ entityId: string; productType: MarketplaceProductTypeId } | null> {
  const [row] = await withTenant(identity, (tx) =>
    tx
      .select({ entityId: marketplaceListings.entityId, productType: marketplaceListings.productType })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, listingId)),
  );
  return row ? { entityId: row.entityId, productType: row.productType as MarketplaceProductTypeId } : null;
}

/** Add a pricing dimension to a listing (records an add_dimension change set). */
export async function addPricingDimension(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in." };
  const listingId = field(formData.get("listingId"));
  const aws = await listingAws(identity, listingId);
  if (!aws) return { ok: false, error: "Listing not found." };
  const name = field(formData.get("name"));
  const price = Math.round(Number(field(formData.get("price")) || "0") * 100);

  let change: ChangeApplication;
  try {
    change = await resolveChange(identity, "add_dimension", aws.entityId, aws.productType, { name, price });
  } catch (err) {
    await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
    return { ok: false, error: "AWS rejected the pricing change -- check the connection and try again." };
  }

  try {
    await runMutation({
      permission: "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ listingId, name, price }),
      action: "marketplace.add_dimension",
      resourceType: "marketplace_listing",
      auditMetadata: { listingId },
      handler: (ctx) =>
        addPricingDimensionOp(
          ctx,
          {
            listingId,
            apiName: field(formData.get("apiName")),
            name,
            unit: field(formData.get("unit")),
            price,
            dimensionType: (field(formData.get("dimensionType")) || "usage") as MarketplaceDimensionTypeId,
          },
          change,
        ),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/marketplace/${listingId}`);
  return { ok: true };
}

async function changeAction(
  formData: FormData,
  intent: ApplyIntent,
  build: (formData: FormData) => { payload: Record<string, unknown>; input: Record<string, unknown> },
): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in." };
  const listingId = field(formData.get("listingId"));
  const aws = await listingAws(identity, listingId);
  if (!aws) return { ok: false, error: "Listing not found." };
  const { payload, input } = build(formData);

  let change: ChangeApplication;
  try {
    change = await resolveChange(identity, intent, aws.entityId, aws.productType, payload);
  } catch (err) {
    await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
    return { ok: false, error: "AWS rejected the change -- check the connection and try again." };
  }

  try {
    await runMutation({
      permission: intent === "publish" ? "marketplace:publish" : "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ listingId, intent }),
      action: `marketplace.${intent}`,
      resourceType: "marketplace_listing",
      auditMetadata: { listingId },
      handler: (ctx) => applyListingChangeOp(ctx, { listingId, intent, ...input }, change),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  return { ok: true };
}

type ApplyIntent = "update_details" | "update_visibility" | "publish";

export async function updateListingDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return changeAction(formData, "update_details", (fd) => {
    const title = field(fd.get("title"));
    const description = field(fd.get("description"));
    return { payload: { title, description }, input: { title, description } };
  });
}

export async function updateListingVisibility(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return changeAction(formData, "update_visibility", (fd) => {
    const visibility = (field(fd.get("visibility")) || "limited") as MarketplaceVisibilityId;
    return { payload: { visibility }, input: { visibility } };
  });
}

export async function publishListing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return changeAction(formData, "publish", () => ({ payload: { publish: true }, input: {} }));
}

/** Refresh an in-flight change set's status from AWS (DescribeChangeSet, two-phase). Gated. */
export async function refreshChangeSet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in." };
  const changeSetRowId = field(formData.get("changeSetRowId"));
  const changeSetId = field(formData.get("changeSetId"));
  const listingId = field(formData.get("listingId"));

  let status: MarketplaceChangeStatusId;
  let error = "";
  const conn = await marketplaceConfig(identity);
  if (conn && conn.enabled && changeSetId) {
    try {
      const res = await describeMarketplaceChangeSet(conn.cfg, changeSetId);
      status = changeStatusFromAws(res.status);
      error = res.failureDescription;
    } catch (err) {
      await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
      return { ok: false, error: "Could not refresh the change-set status from AWS." };
    }
  } else {
    // Local/dev (or a change set with no AWS id): a recorded change set resolves on refresh.
    status = "succeeded";
  }

  try {
    await runMutation({
      permission: "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ changeSetRowId, status }),
      action: "marketplace.refresh_changeset",
      resourceType: "marketplace_changeset",
      auditMetadata: { changeSetRowId, status },
      handler: (ctx) => refreshChangeSetOp(ctx, { changeSetRowId, status, error }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/marketplace/${listingId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Metering -- partner-originated usage submitted to AWS (BatchMeterUsage). The
// per-record accepted/rejected result is stored.
// ---------------------------------------------------------------------------

/** Submit one usage record to AWS Marketplace metering (two-phase). */
export async function submitMetering(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in." };
  const listingId = field(formData.get("listingId"));
  const dimension = field(formData.get("dimension"));
  const customerIdentifier = field(formData.get("customerIdentifier"));
  const quantity = Math.max(0, Math.round(Number(field(formData.get("quantity")) || "0")));
  if (!listingId || !dimension) return { ok: false, error: "A listing and dimension are required." };

  const [listing] = await withTenant(identity, (tx) =>
    tx
      .select({ productCode: marketplaceListings.productCode })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, listingId)),
  );
  if (!listing) return { ok: false, error: "Listing not found." };

  // Phase 1: submit to AWS (or accept locally when disconnected).
  let result: MeteringResultRow;
  const conn = await marketplaceConfig(identity);
  if (conn && conn.enabled) {
    try {
      const res = await batchMeterMarketplaceUsage(conn.cfg, listing.productCode, [
        { Timestamp: new Date(), CustomerIdentifier: customerIdentifier, Dimension: dimension, Quantity: quantity },
      ]);
      result = res.results[0]
        ? mapUsageResult(res.results[0])
        : { meteringRecordId: "", status: "rejected", dimension, customerIdentifier, quantity };
    } catch (err) {
      await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
      return { ok: false, error: "AWS rejected the usage record -- check the connection and try again." };
    }
  } else {
    result = { meteringRecordId: "", status: "accepted", dimension, customerIdentifier, quantity };
  }

  try {
    await runMutation({
      permission: "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ listingId, dimension, quantity }),
      action: "marketplace.submit_metering",
      resourceType: "marketplace_metering",
      auditMetadata: { listingId, status: result.status },
      handler: (ctx) => submitMeteringOp(ctx, { listingId, dimension, customerIdentifier, quantity }, result),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/metering");
  return { ok: true };
}

/**
 * Bulk-retry rejected usage records (two-phase like submitMetering). Phase 1
 * re-sends each eligible record to AWS BatchMeterUsage, grouped per product
 * code in chunks of 25 (the API cap) — or accepts locally when disconnected.
 * Phase 2 is ONE gated mutation that inserts the retry outcomes and annotates
 * the sources result='Resubmitted' (status stays rejected — honest history).
 */
export async function resubmitMetering(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in." };

  let ids: string[];
  try {
    ids = parseBulkIds(formData.get("ids"));
  } catch (err) {
    return failure(err);
  }

  // Only rejected + not-yet-resubmitted rows qualify; the op re-checks inside
  // the tx, this read just shapes the AWS calls.
  const rows = await withTenant(identity, (tx) =>
    tx
      .select({
        id: marketplaceMeteringRecords.id,
        listingId: marketplaceMeteringRecords.listingId,
        dimension: marketplaceMeteringRecords.dimension,
        customerIdentifier: marketplaceMeteringRecords.customerIdentifier,
        quantity: marketplaceMeteringRecords.quantity,
        productCode: marketplaceListings.productCode,
      })
      .from(marketplaceMeteringRecords)
      .innerJoin(marketplaceListings, eq(marketplaceListings.id, marketplaceMeteringRecords.listingId))
      .where(
        and(
          inArray(marketplaceMeteringRecords.id, ids),
          eq(marketplaceMeteringRecords.tenantId, identity.tenantId),
          eq(marketplaceMeteringRecords.status, "rejected"),
          sql`${marketplaceMeteringRecords.result} <> 'Resubmitted'`,
        ),
      ),
  );
  if (rows.length === 0) return { ok: false, error: "No eligible rejected records selected." };

  // Phase 1: AWS (per product code, 25 records per call) or local-accept when
  // disconnected — mirrors the single submitMetering path.
  const items: ResubmitMeteringItem[] = [];
  const conn = await marketplaceConfig(identity);
  if (conn && conn.enabled) {
    const byProduct = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byProduct.get(r.productCode) ?? [];
      arr.push(r);
      byProduct.set(r.productCode, arr);
    }
    try {
      for (const [productCode, group] of byProduct) {
        for (const batch of chunk(group, 25)) {
          const res = await batchMeterMarketplaceUsage(
            conn.cfg,
            productCode,
            batch.map((r) => ({
              Timestamp: new Date(),
              CustomerIdentifier: r.customerIdentifier,
              Dimension: r.dimension,
              Quantity: r.quantity,
            })),
          );
          batch.forEach((r, i) => {
            const raw = res.results[i];
            items.push({
              sourceId: r.id,
              listingId: r.listingId,
              result: raw
                ? mapUsageResult(raw)
                : { meteringRecordId: "", status: "rejected", dimension: r.dimension, customerIdentifier: r.customerIdentifier, quantity: r.quantity },
            });
          });
        }
      }
    } catch (err) {
      await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
      return { ok: false, error: "AWS rejected the resubmission -- check the connection and try again." };
    }
  } else {
    for (const r of rows) {
      items.push({
        sourceId: r.id,
        listingId: r.listingId,
        result: { meteringRecordId: "", status: "accepted", dimension: r.dimension, customerIdentifier: r.customerIdentifier, quantity: r.quantity },
      });
    }
  }

  // Phase 2: one gated mutation records everything.
  let resubmitted = 0;
  try {
    const res = await runMutation({
      permission: "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ ids }),
      action: "marketplace.resubmit_metering",
      resourceType: "marketplace_metering",
      auditMetadata: { count: items.length },
      handler: (ctx) => resubmitMeteringOp(ctx, items),
    });
    resubmitted = res.body.resubmitted;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/metering");
  return {
    ok: true,
    detail: `Resubmitted ${resubmitted} ${resubmitted === 1 ? "record" : "records"} to AWS.`,
  };
}

// ---------------------------------------------------------------------------
// Entitlements + Billing -- read-only mirrors synced from AWS (GetEntitlements /
// SearchAgreements + ListAgreementCharges).
// ---------------------------------------------------------------------------

/** Sync entitlements for every listing's product code from the Entitlement API. Gated. */
export async function syncEntitlements(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in to sync." };
  const conn = await marketplaceConfig(identity);
  if (!conn || !conn.enabled) {
    return { ok: false, error: "Configure and enable the AWS Marketplace connection in Settings first." };
  }
  const codes = await withTenant(identity, (tx) =>
    tx
      .select({ productCode: marketplaceListings.productCode })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.tenantId, identity.tenantId)),
  );
  const productCodes = [...new Set(codes.map((c) => c.productCode).filter((p) => p))];

  let rows: EntitlementRow[];
  try {
    const all: EntitlementRow[] = [];
    for (const pc of productCodes) {
      const ents = await getMarketplaceEntitlements(conn.cfg, pc);
      all.push(...ents.map(mapEntitlement).filter((r): r is EntitlementRow => r !== null));
    }
    rows = all;
  } catch (err) {
    await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
    return { ok: false, error: "AWS Marketplace entitlement sync failed -- check the connection." };
  }

  try {
    await runMutation({
      permission: "marketplace:sync",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ count: rows.length }),
      action: "marketplace.sync_entitlements",
      resourceType: "marketplace_entitlements",
      auditMetadata: { count: rows.length },
      handler: (ctx) => syncEntitlementsOp(ctx, rows),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/entitlements");
  return { ok: true };
}

/** Sync agreements + charges from the Agreement API. Gated. */
export async function syncBilling(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identity = await getServerIdentity().catch(() => null);
  if (!identity) return { ok: false, error: "Sign in to sync." };
  const conn = await marketplaceConfig(identity);
  if (!conn || !conn.enabled) {
    return { ok: false, error: "Configure and enable the AWS Marketplace connection in Settings first." };
  }

  let agreements: AgreementRow[];
  let charges: AgreementChargeRow[];
  try {
    const summaries = await searchMarketplaceAgreements(conn.cfg);
    agreements = summaries.map(mapAgreement).filter((r): r is AgreementRow => r !== null);
    const allCharges: AgreementChargeRow[] = [];
    for (const a of agreements) {
      allCharges.push(...(await listMarketplaceAgreementCharges(conn.cfg, a.agreementId)));
    }
    charges = allCharges;
  } catch (err) {
    await stampMarketplaceError(identity, err instanceof Error ? err.message : "Unknown error");
    return { ok: false, error: "AWS Marketplace billing sync failed -- check the connection." };
  }

  try {
    await runMutation({
      permission: "marketplace:sync",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ agreements: agreements.length, charges: charges.length }),
      action: "marketplace.sync_billing",
      resourceType: "marketplace_agreements",
      auditMetadata: { agreements: agreements.length, charges: charges.length },
      handler: (ctx) => syncBillingOp(ctx, agreements, charges),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/billing");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PRM -- partner-managed attribution-method config per listing.
// ---------------------------------------------------------------------------

/** Link (or unlink) a listing to a tenant Solution. Gated. */
export async function linkListingToSolution(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const listingId = field(formData.get("listingId"));
  try {
    const raw = field(formData.get("solutionId"));
    const solutionId = raw === "" ? null : raw;
    await runMutation({
      permission: "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ listingId, solutionId }),
      action: "marketplace.link_solution",
      resourceType: "marketplace_listing",
      auditMetadata: { listingId, solutionId },
      handler: (ctx) => linkListingToSolutionOp(ctx, { listingId, solutionId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/programs/solutions");
  return { ok: true };
}

/** Enable/disable a PRM attribution method for a listing. Gated. */
export async function configureAttributionMethod(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const listingId = field(formData.get("listingId"));
    const method = (field(formData.get("method")) || "marketplace_metering") as MarketplaceAttributionMethodId;
    const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
    const notes = field(formData.get("notes")).slice(0, 1000);
    await runMutation({
      permission: "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ listingId, method, enabled }),
      action: "marketplace.configure_attribution",
      resourceType: "marketplace_listing",
      auditMetadata: { listingId, method, enabled },
      handler: (ctx) => configureAttributionMethodOp(ctx, { listingId, method, enabled, notes }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/revenue");
  return { ok: true };
}
