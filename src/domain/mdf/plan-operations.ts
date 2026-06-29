import { and, eq, sql } from "drizzle-orm";
import { mdfEventPlans, mdfPlanItems, mdfRequests } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { activityByKey } from "@/domain/mdf/activity-catalog";
import { coFunding, derivedDeadlines, isBlocked, type PlanItemLike } from "@/domain/mdf/compliance";
import { createRequestOp } from "@/domain/mdf/operations";

/**
 * Database side of the MDF event planner. A plan (mdf_event_plans) holds candidate
 * events (mdf_plan_items); each item is grounded to an AWS activity-catalog entry.
 * Converting an eligible item reuses `createRequestOp` so the planned event flows
 * straight into the existing request lifecycle. Gate-driven (MutationContext).
 */

type ActivityType = "event" | "campaign" | "content" | "enablement" | "other";

function deriveActivityType(catalogKey: string | null): ActivityType {
  return (activityByKey(catalogKey)?.category as ActivityType | undefined) ?? "other";
}

export interface PlanInput {
  readonly title: string;
  readonly notes: string;
}

export async function createPlanOp(
  { identity, tx }: MutationContext,
  input: PlanInput,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(mdfEventPlans)
    .values({ tenantId: identity.tenantId, title: input.title, notes: input.notes, createdBy: identity.userId })
    .returning({ id: mdfEventPlans.id });
  return { id: row!.id };
}

export async function updatePlanOp(
  { identity, tx }: MutationContext,
  input: { readonly id: string; readonly title?: string; readonly notes?: string; readonly status?: string },
): Promise<{ id: string }> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.title !== undefined) set.title = input.title;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.status !== undefined) set.status = input.status;
  const updated = await tx
    .update(mdfEventPlans)
    .set(set)
    .where(and(eq(mdfEventPlans.id, input.id), eq(mdfEventPlans.tenantId, identity.tenantId)))
    .returning({ id: mdfEventPlans.id });
  if (updated.length === 0) throw new ValidationError("Plan not found");
  return { id: input.id };
}

export interface PlanItemInput {
  readonly planId: string;
  readonly title: string;
  readonly catalogKey: string | null;
  readonly totalCost: number;
  readonly coFundPct: number;
  readonly expectedPipeline: number;
  readonly expectedOpportunities: number;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly spmsId: string | null;
}

async function assertPlanInTenant(ctx: MutationContext, planId: string): Promise<void> {
  const [plan] = await ctx.tx
    .select({ id: mdfEventPlans.id })
    .from(mdfEventPlans)
    .where(and(eq(mdfEventPlans.id, planId), eq(mdfEventPlans.tenantId, ctx.identity.tenantId)));
  if (!plan) throw new ValidationError("Plan not found");
}

export async function addPlanItemOp(
  ctx: MutationContext,
  input: PlanItemInput,
): Promise<{ id: string }> {
  await assertPlanInTenant(ctx, input.planId);
  const [row] = await ctx.tx
    .insert(mdfPlanItems)
    .values({
      tenantId: ctx.identity.tenantId,
      planId: input.planId,
      title: input.title,
      catalogKey: input.catalogKey,
      activityType: deriveActivityType(input.catalogKey),
      totalCost: input.totalCost,
      coFundPct: input.coFundPct,
      expectedPipeline: input.expectedPipeline,
      expectedOpportunities: input.expectedOpportunities,
      startDate: input.startDate,
      endDate: input.endDate,
      spmsId: input.spmsId,
    })
    .returning({ id: mdfPlanItems.id });
  return { id: row!.id };
}

export async function updatePlanItemOp(
  { identity, tx }: MutationContext,
  input: Omit<PlanItemInput, "planId"> & { readonly id: string },
): Promise<{ id: string }> {
  const updated = await tx
    .update(mdfPlanItems)
    .set({
      title: input.title,
      catalogKey: input.catalogKey,
      activityType: deriveActivityType(input.catalogKey),
      totalCost: input.totalCost,
      coFundPct: input.coFundPct,
      expectedPipeline: input.expectedPipeline,
      expectedOpportunities: input.expectedOpportunities,
      startDate: input.startDate,
      endDate: input.endDate,
      spmsId: input.spmsId,
      updatedAt: sql`now()`,
    })
    .where(and(eq(mdfPlanItems.id, input.id), eq(mdfPlanItems.tenantId, identity.tenantId)))
    .returning({ id: mdfPlanItems.id });
  if (updated.length === 0) throw new ValidationError("Plan item not found");
  return { id: input.id };
}

export async function removePlanItemOp(
  { identity, tx }: MutationContext,
  input: { readonly id: string },
): Promise<{ id: string }> {
  await tx
    .delete(mdfPlanItems)
    .where(and(eq(mdfPlanItems.id, input.id), eq(mdfPlanItems.tenantId, identity.tenantId)));
  return { id: input.id };
}

/**
 * Convert an eligible plan item into a draft MDF request (reusing `createRequestOp`),
 * grounding the request in the catalog and linking the item back. Refuses a blocked
 * item (hard AWS-rule violation) and a double-convert.
 */
export async function convertPlanItemToRequestOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly today: string },
): Promise<{ requestId: string; planId: string }> {
  const { identity, tx } = ctx;
  const [item] = await tx
    .select()
    .from(mdfPlanItems)
    .where(and(eq(mdfPlanItems.id, input.id), eq(mdfPlanItems.tenantId, identity.tenantId)));
  if (!item) throw new ValidationError("Plan item not found");
  if (item.requestId) throw new ValidationError("This item has already been converted to a request");

  const likeness: PlanItemLike = {
    catalogKey: item.catalogKey,
    startDate: item.startDate,
    endDate: item.endDate,
    totalCost: item.totalCost,
    coFundPct: item.coFundPct,
  };
  if (isBlocked(likeness, input.today)) {
    throw new ValidationError("Resolve the blocking AWS-rule issues before converting this item");
  }

  const ask = coFunding(item.totalCost, item.coFundPct).amountToClaim;
  const { claimBy } = derivedDeadlines(item.startDate, item.endDate);

  const { id: requestId } = await createRequestOp(ctx, {
    title: item.title,
    activityType: item.activityType,
    requestedAmount: ask,
    expectedPipeline: item.expectedPipeline,
    ownerUserId: null,
    startDate: item.startDate,
    endDate: item.endDate,
    claimDeadline: claimBy,
    opportunityRef: null,
  });

  // Ground the new request in the catalog + carry the full activity cost.
  await tx
    .update(mdfRequests)
    .set({ catalogKey: item.catalogKey, totalCost: item.totalCost, updatedAt: sql`now()` })
    .where(and(eq(mdfRequests.id, requestId), eq(mdfRequests.tenantId, identity.tenantId)));

  await tx
    .update(mdfPlanItems)
    .set({ requestId, updatedAt: sql`now()` })
    .where(and(eq(mdfPlanItems.id, item.id), eq(mdfPlanItems.tenantId, identity.tenantId)));

  return { requestId, planId: item.planId };
}
