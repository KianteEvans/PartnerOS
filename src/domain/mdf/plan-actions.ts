"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { planSchema, planItemSchema, planIdSchema, itemIdSchema } from "@/domain/mdf/plan-schemas";
import {
  createPlanOp,
  updatePlanOp,
  addPlanItemOp,
  updatePlanItemOp,
  removePlanItemOp,
  convertPlanItemToRequestOp,
} from "@/domain/mdf/plan-operations";

/**
 * MDF event-planner server actions: validation + the mutation gate. Plans + items
 * reuse `mdf:create` (a planning artifact, no new permission). DB work lives in
 * plan-operations.ts.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function itemFields(formData: FormData) {
  return parseOrThrow(planItemSchema, {
    title: formData.get("title"),
    catalogKey: formData.get("catalogKey"),
    totalCost: formData.get("totalCost"),
    coFundPct: formData.get("coFundPct"),
    expectedPipeline: formData.get("expectedPipeline"),
    expectedOpportunities: formData.get("expectedOpportunities"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    spmsId: formData.get("spmsId"),
  });
}

export async function createMdfPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(planSchema, { title: formData.get("title"), notes: formData.get("notes") });
    const res = await runMutation({
      permission: "mdf:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "mdf.plan.create",
      resourceType: "mdf_event_plan",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => createPlanOp(ctx, input),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/mdf/plan");
  redirect(`/mdf/plan/${newId}`);
}

export async function updateMdfPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let planId = "";
  try {
    planId = parseOrThrow(planIdSchema, { planId: formData.get("planId") }).planId;
    const input = parseOrThrow(planSchema, { title: formData.get("title"), notes: formData.get("notes") });
    await runMutation({
      permission: "mdf:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ planId, ...input }),
      action: "mdf.plan.update",
      resourceType: "mdf_event_plan",
      resourceId: () => planId,
      handler: (ctx) => updatePlanOp(ctx, { id: planId, ...input }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/plan/${planId}`);
  return { ok: true };
}

export async function archiveMdfPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let planId = "";
  try {
    planId = parseOrThrow(planIdSchema, { planId: formData.get("planId") }).planId;
    await runMutation({
      permission: "mdf:create",
      idempotencyKey: `archive-mdf-plan:${planId}`,
      rawBody: JSON.stringify({ planId }),
      action: "mdf.plan.archive",
      resourceType: "mdf_event_plan",
      resourceId: () => planId,
      handler: (ctx) => updatePlanOp(ctx, { id: planId, status: "archived" }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/mdf/plan");
  redirect("/mdf/plan");
}

export async function addMdfPlanItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let planId = "";
  try {
    planId = parseOrThrow(planIdSchema, { planId: formData.get("planId") }).planId;
    const fields = itemFields(formData);
    await runMutation({
      permission: "mdf:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ planId, ...fields }),
      action: "mdf.plan.item.add",
      resourceType: "mdf_plan_item",
      handler: (ctx) => addPlanItemOp(ctx, { planId, ...fields }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/plan/${planId}`);
  return { ok: true };
}

export async function updateMdfPlanItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let planId = "";
  try {
    planId = parseOrThrow(planIdSchema, { planId: formData.get("planId") }).planId;
    const itemId = parseOrThrow(itemIdSchema, { itemId: formData.get("itemId") }).itemId;
    const fields = itemFields(formData);
    await runMutation({
      permission: "mdf:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ itemId, ...fields }),
      action: "mdf.plan.item.update",
      resourceType: "mdf_plan_item",
      resourceId: () => itemId,
      handler: (ctx) => updatePlanItemOp(ctx, { id: itemId, ...fields }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/plan/${planId}`);
  return { ok: true };
}

export async function removeMdfPlanItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let planId = "";
  try {
    planId = parseOrThrow(planIdSchema, { planId: formData.get("planId") }).planId;
    const itemId = parseOrThrow(itemIdSchema, { itemId: formData.get("itemId") }).itemId;
    await runMutation({
      permission: "mdf:create",
      idempotencyKey: `remove-mdf-item:${itemId}`,
      rawBody: JSON.stringify({ itemId }),
      action: "mdf.plan.item.remove",
      resourceType: "mdf_plan_item",
      resourceId: () => itemId,
      handler: (ctx) => removePlanItemOp(ctx, { id: itemId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/plan/${planId}`);
  return { ok: true };
}

export async function convertMdfPlanItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let planId = "";
  try {
    const itemId = parseOrThrow(itemIdSchema, { itemId: formData.get("itemId") }).itemId;
    const res = await runMutation({
      permission: "mdf:create",
      idempotencyKey: `convert-mdf-item:${itemId}`,
      rawBody: JSON.stringify({ itemId }),
      action: "mdf.plan.item.convert",
      resourceType: "mdf_request",
      resourceId: (r: { requestId: string }) => r.requestId,
      auditMetadata: { event: "mdf_plan_converted" },
      handler: (ctx) => convertPlanItemToRequestOp(ctx, { id: itemId, today: today() }),
    });
    planId = res.body.planId;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/plan/${planId}`);
  revalidatePath("/mdf");
  return { ok: true };
}
