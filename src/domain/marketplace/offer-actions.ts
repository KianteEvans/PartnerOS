"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createPrivateOfferSchema,
  updatePrivateOfferSchema,
  offerIdSchema,
  offerStatusSchema,
} from "@/domain/marketplace/offer-schemas";
import {
  createPrivateOfferOp,
  updatePrivateOfferOp,
  setPrivateOfferStatusOp,
} from "@/domain/marketplace/offer-operations";
import { PRIVATE_OFFER_STATUS_LABELS } from "@/domain/marketplace/private-offers";

/**
 * Co-sell private-offer server actions: validation, idempotency, Next plumbing only.
 * DB work + the state machine guard live in offer-operations.ts. Private offers are
 * partner-side local records (no AWS write), so they ride the marketplace create/update
 * permissions.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function oid(formData: FormData): string {
  return parseOrThrow(offerIdSchema, { offerId: formData.get("offerId") }).offerId;
}

function offerFields(formData: FormData) {
  return {
    title: formData.get("title"),
    opportunityId: formData.get("opportunityId"),
    listingId: formData.get("listingId"),
    customerIdentifier: formData.get("customerIdentifier"),
    customerName: formData.get("customerName"),
    offerValue: formData.get("offerValue"),
    discountPct: formData.get("discountPct"),
    currency: formData.get("currency"),
    expirationDate: formData.get("expirationDate"),
    notes: formData.get("notes"),
  };
}

export async function createPrivateOffer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = parseOrThrow(createPrivateOfferSchema, offerFields(formData));
    await runMutation({
      permission: "marketplace:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "marketplace.offer_create",
      resourceType: "marketplace_private_offer",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { offerValue: input.offerValue },
      handler: (ctx) => createPrivateOfferOp(ctx, { ...input, ownerUserId: null }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/offers");
  return { ok: true, detail: "Private offer drafted." };
}

export async function updatePrivateOffer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let offerId = "";
  try {
    offerId = oid(formData);
    const input = parseOrThrow(updatePrivateOfferSchema, offerFields(formData));
    await runMutation({
      permission: "marketplace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ id: offerId, ...input }),
      action: "marketplace.offer_update",
      resourceType: "marketplace_private_offer",
      resourceId: () => offerId,
      handler: (ctx) => updatePrivateOfferOp(ctx, { id: offerId, ...input }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/offers");
  return { ok: true };
}

export async function setPrivateOfferStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let offerId = "";
  let status: (typeof offerStatusSchema)["_output"]["status"] = "draft";
  try {
    offerId = oid(formData);
    status = parseOrThrow(offerStatusSchema, { status: formData.get("status") }).status;
    await runMutation({
      permission: "marketplace:update",
      idempotencyKey: `offer-status:${offerId}:${status}`,
      rawBody: JSON.stringify({ id: offerId, status }),
      action: "marketplace.offer_status",
      resourceType: "marketplace_private_offer",
      resourceId: () => offerId,
      auditMetadata: { status },
      handler: (ctx) => setPrivateOfferStatusOp(ctx, { id: offerId, status }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/marketplace/offers");
  return { ok: true, detail: `Offer marked ${PRIVATE_OFFER_STATUS_LABELS[status]}.` };
}
