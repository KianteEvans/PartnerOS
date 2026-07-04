import { and, eq, sql } from "drizzle-orm";
import {
  marketplacePrivateOffers,
  marketplaceAgreements,
  marketplaceListings,
  opportunities,
  users,
} from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { canTransition, matchAgreementForOffer, type PrivateOfferStatus } from "@/domain/marketplace/private-offers";

/**
 * The database side of co-sell private offers. A private offer is a partner-drafted
 * artifact that links an ACE opportunity to the Marketplace agreement it closes as;
 * it moves through draft -> sent -> accepted (status-guarded) and reconciles onto a
 * synced AWS agreement when the customer accepts. Factored out of the actions so the
 * gate drives them in tests.
 */

async function assertOwnerInTenant(tx: MutationContext["tx"], tenantId: string, ownerUserId: string): Promise<void> {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.tenantId, tenantId)));
  if (!owner) throw new ValidationError("Owner is not a member of this workspace");
}

async function assertOpportunityInTenant(tx: MutationContext["tx"], tenantId: string, oppId: string): Promise<void> {
  const [opp] = await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, oppId), eq(opportunities.tenantId, tenantId)));
  if (!opp) throw new ValidationError("Linked opportunity is not in this workspace");
}

async function assertListingInTenant(tx: MutationContext["tx"], tenantId: string, listingId: string): Promise<void> {
  const [l] = await tx
    .select({ id: marketplaceListings.id })
    .from(marketplaceListings)
    .where(and(eq(marketplaceListings.id, listingId), eq(marketplaceListings.tenantId, tenantId)));
  if (!l) throw new ValidationError("Linked listing is not in this workspace");
}

async function loadOffer(ctx: MutationContext, id: string): Promise<typeof marketplacePrivateOffers.$inferSelect> {
  const [row] = await ctx.tx
    .select()
    .from(marketplacePrivateOffers)
    .where(and(eq(marketplacePrivateOffers.id, id), eq(marketplacePrivateOffers.tenantId, ctx.identity.tenantId)));
  if (!row) throw new ValidationError("Private offer not found");
  return row;
}

export interface CreatePrivateOfferInput {
  readonly title: string;
  readonly opportunityId: string | null;
  readonly listingId: string | null;
  readonly customerIdentifier: string;
  readonly customerName: string;
  readonly offerValue: number;
  readonly discountPct: number;
  readonly currency: string;
  readonly expirationDate: string | null;
  readonly notes: string;
  readonly ownerUserId: string | null;
}

export async function createPrivateOfferOp(
  { identity, tx }: MutationContext,
  input: CreatePrivateOfferInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  if (input.opportunityId) await assertOpportunityInTenant(tx, identity.tenantId, input.opportunityId);
  if (input.listingId) await assertListingInTenant(tx, identity.tenantId, input.listingId);
  const [row] = await tx
    .insert(marketplacePrivateOffers)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      opportunityId: input.opportunityId,
      listingId: input.listingId,
      customerIdentifier: input.customerIdentifier,
      customerName: input.customerName,
      offerValue: input.offerValue,
      discountPct: input.discountPct,
      currency: input.currency,
      expirationDate: input.expirationDate,
      notes: input.notes,
      ownerUserId: input.ownerUserId,
      createdBy: identity.userId,
    })
    .returning({ id: marketplacePrivateOffers.id });
  return { id: row!.id };
}

export interface UpdatePrivateOfferInput {
  readonly id: string;
  readonly title?: string;
  readonly opportunityId?: string | null;
  readonly listingId?: string | null;
  readonly customerIdentifier?: string;
  readonly customerName?: string;
  readonly offerValue?: number;
  readonly discountPct?: number;
  readonly currency?: string;
  readonly expirationDate?: string | null;
  readonly notes?: string;
}

export async function updatePrivateOfferOp(ctx: MutationContext, input: UpdatePrivateOfferInput): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  const current = await loadOffer(ctx, input.id);
  if (current.status !== "draft") throw new ValidationError("Only a draft offer can be edited");
  if (input.opportunityId) await assertOpportunityInTenant(tx, identity.tenantId, input.opportunityId);
  if (input.listingId) await assertListingInTenant(tx, identity.tenantId, input.listingId);

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.title !== undefined) set.title = input.title;
  if (input.opportunityId !== undefined) set.opportunityId = input.opportunityId;
  if (input.listingId !== undefined) set.listingId = input.listingId;
  if (input.customerIdentifier !== undefined) set.customerIdentifier = input.customerIdentifier;
  if (input.customerName !== undefined) set.customerName = input.customerName;
  if (input.offerValue !== undefined) set.offerValue = input.offerValue;
  if (input.discountPct !== undefined) set.discountPct = input.discountPct;
  if (input.currency !== undefined) set.currency = input.currency;
  if (input.expirationDate !== undefined) set.expirationDate = input.expirationDate;
  if (input.notes !== undefined) set.notes = input.notes;

  await tx
    .update(marketplacePrivateOffers)
    .set(set)
    .where(and(eq(marketplacePrivateOffers.id, input.id), eq(marketplacePrivateOffers.tenantId, identity.tenantId)));
  return { id: input.id };
}

/** Status-guarded transition. Stamps sent_at / decided_at as the offer moves. */
export async function setPrivateOfferStatusOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly status: PrivateOfferStatus },
): Promise<{ status: PrivateOfferStatus }> {
  const current = await loadOffer(ctx, input.id);
  if (!canTransition(current.status, input.status)) {
    throw new ValidationError(`Cannot move a ${current.status} offer to ${input.status}`);
  }
  const set: Record<string, unknown> = { status: input.status, updatedAt: sql`now()` };
  if (input.status === "sent") set.sentAt = sql`now()`;
  if (input.status === "accepted" || input.status === "declined" || input.status === "expired") {
    set.decidedAt = sql`now()`;
  }
  const updated = await ctx.tx
    .update(marketplacePrivateOffers)
    .set(set)
    .where(
      and(
        eq(marketplacePrivateOffers.id, input.id),
        eq(marketplacePrivateOffers.tenantId, ctx.identity.tenantId),
        eq(marketplacePrivateOffers.status, current.status),
      ),
    )
    .returning({ id: marketplacePrivateOffers.id });
  if (updated.length === 0) throw new ValidationError("Offer is not in the expected state for this transition");
  return { status: input.status };
}

/**
 * Reconcile SENT offers onto the synced AWS agreements. For each sent offer whose
 * customer (+ listing) now has a matching agreement, link the agreement and accept the
 * offer. Called at the end of syncBillingOp — accepting happens when AWS confirms the
 * transaction. Idempotent: already-accepted offers are not re-touched.
 */
export async function reconcilePrivateOffersOp({ identity, tx }: MutationContext): Promise<{ reconciled: number }> {
  const offers = await tx
    .select({
      id: marketplacePrivateOffers.id,
      customerIdentifier: marketplacePrivateOffers.customerIdentifier,
      listingId: marketplacePrivateOffers.listingId,
    })
    .from(marketplacePrivateOffers)
    .where(and(eq(marketplacePrivateOffers.tenantId, identity.tenantId), eq(marketplacePrivateOffers.status, "sent")));
  if (offers.length === 0) return { reconciled: 0 };

  const agreements = await tx
    .select({
      id: marketplaceAgreements.id,
      customerIdentifier: marketplaceAgreements.customerIdentifier,
      listingId: marketplaceAgreements.listingId,
      offerType: marketplaceAgreements.offerType,
    })
    .from(marketplaceAgreements)
    .where(eq(marketplaceAgreements.tenantId, identity.tenantId));

  let reconciled = 0;
  for (const offer of offers) {
    const match = matchAgreementForOffer(offer, agreements);
    if (!match) continue;
    const res = await tx
      .update(marketplacePrivateOffers)
      .set({ status: "accepted", agreementId: match.id, decidedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(marketplacePrivateOffers.id, offer.id),
          eq(marketplacePrivateOffers.tenantId, identity.tenantId),
          eq(marketplacePrivateOffers.status, "sent"),
        ),
      )
      .returning({ id: marketplacePrivateOffers.id });
    reconciled += res.length;
  }
  return { reconciled };
}
