import { and, eq, inArray, sql } from "drizzle-orm";
import { fundingSubmissions, opportunities, users } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import type { FundingSubmissionStatus } from "@/domain/funding/lifecycle";

/**
 * The database side of AWS Funding submissions. Factored out of the actions so the gate
 * drives them in tests. Each lifecycle transition is status-guarded (only the expected
 * prior state advances), so concurrent or replayed transitions can't corrupt the state
 * machine. Generic + lightweight — the MDF-specific co-fund/claim machinery lives in MDF.
 */

type FundingKind = "cash" | "credits";

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

async function loadSubmission(ctx: MutationContext, id: string): Promise<typeof fundingSubmissions.$inferSelect> {
  const [row] = await ctx.tx
    .select()
    .from(fundingSubmissions)
    .where(and(eq(fundingSubmissions.id, id), eq(fundingSubmissions.tenantId, ctx.identity.tenantId)));
  if (!row) throw new ValidationError("Funding submission not found");
  return row;
}

export interface CreateSubmissionInput {
  readonly programKey: string;
  readonly title: string;
  readonly fundingType: FundingKind;
  readonly requestedAmount: number;
  readonly workloadType: string;
  readonly customerSegment: string;
  readonly opportunityId: string | null;
  readonly deadline: string | null;
  readonly externalRef: string;
  readonly ownerUserId: string | null;
}

export async function createSubmissionOp(
  { identity, tx }: MutationContext,
  input: CreateSubmissionInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  if (input.opportunityId) await assertOpportunityInTenant(tx, identity.tenantId, input.opportunityId);
  const [row] = await tx
    .insert(fundingSubmissions)
    .values({
      tenantId: identity.tenantId,
      programKey: input.programKey,
      title: input.title,
      fundingType: input.fundingType,
      requestedAmount: input.requestedAmount,
      workloadType: input.workloadType,
      customerSegment: input.customerSegment,
      opportunityId: input.opportunityId,
      deadline: input.deadline,
      externalRef: input.externalRef,
      ownerUserId: input.ownerUserId,
      createdBy: identity.userId,
    })
    .returning({ id: fundingSubmissions.id });
  return { id: row!.id };
}

export interface UpdateSubmissionInput {
  readonly id: string;
  readonly title?: string;
  readonly fundingType?: FundingKind;
  readonly requestedAmount?: number;
  readonly workloadType?: string;
  readonly customerSegment?: string;
  readonly opportunityId?: string | null;
  readonly deadline?: string | null;
  readonly externalRef?: string;
  readonly ownerUserId?: string | null;
}

export async function updateSubmissionOp(ctx: MutationContext, input: UpdateSubmissionInput): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  const current = await loadSubmission(ctx, input.id);
  if (current.status !== "draft") throw new ValidationError("Only a draft submission can be edited");
  if (input.ownerUserId) await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  if (input.opportunityId) await assertOpportunityInTenant(tx, identity.tenantId, input.opportunityId);

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.title !== undefined) set.title = input.title;
  if (input.fundingType !== undefined) set.fundingType = input.fundingType;
  if (input.requestedAmount !== undefined) set.requestedAmount = input.requestedAmount;
  if (input.workloadType !== undefined) set.workloadType = input.workloadType;
  if (input.customerSegment !== undefined) set.customerSegment = input.customerSegment;
  if (input.opportunityId !== undefined) set.opportunityId = input.opportunityId;
  if (input.deadline !== undefined) set.deadline = input.deadline;
  if (input.externalRef !== undefined) set.externalRef = input.externalRef;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;

  await tx
    .update(fundingSubmissions)
    .set(set)
    .where(and(eq(fundingSubmissions.id, input.id), eq(fundingSubmissions.tenantId, identity.tenantId)));
  return { id: input.id };
}

/** Guarded status flip from one of `from` states to the new state, with extra fields. */
async function advance(
  ctx: MutationContext,
  id: string,
  from: FundingSubmissionStatus | readonly FundingSubmissionStatus[],
  set: Record<string, unknown>,
): Promise<void> {
  const froms = Array.isArray(from) ? from : [from as FundingSubmissionStatus];
  const updated = await ctx.tx
    .update(fundingSubmissions)
    .set({ ...set, updatedAt: sql`now()` })
    .where(
      and(
        eq(fundingSubmissions.id, id),
        eq(fundingSubmissions.tenantId, ctx.identity.tenantId),
        inArray(fundingSubmissions.status, froms),
      ),
    )
    .returning({ id: fundingSubmissions.id });
  if (updated.length === 0) throw new ValidationError(`Submission is not in the expected state for this transition`);
}

/** draft -> submitted. Needs a requested amount. */
export async function submitSubmissionOp(ctx: MutationContext, input: { readonly id: string }): Promise<{ status: "submitted" }> {
  const s = await loadSubmission(ctx, input.id);
  if (s.requestedAmount <= 0) throw new ValidationError("Set a requested amount before submitting");
  await advance(ctx, input.id, "draft", { status: "submitted" });
  return { status: "submitted" };
}

/** submitted -> in_review. */
export async function startReviewOp(ctx: MutationContext, input: { readonly id: string }): Promise<{ status: "in_review" }> {
  await advance(ctx, input.id, "submitted", { status: "in_review" });
  return { status: "in_review" };
}

/** submitted|in_review -> approved. */
export async function approveSubmissionOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly approvedAmount: number; readonly notes: string },
): Promise<{ status: "approved" }> {
  const s = await loadSubmission(ctx, input.id);
  if (input.approvedAmount < 0) throw new ValidationError("Approved amount cannot be negative");
  if (s.requestedAmount > 0 && input.approvedAmount > s.requestedAmount) {
    throw new ValidationError("Approved amount cannot exceed the requested amount");
  }
  await advance(ctx, input.id, ["submitted", "in_review"], {
    status: "approved",
    approvedAmount: input.approvedAmount,
    decisionAt: sql`now()`,
    decisionNotes: input.notes,
  });
  return { status: "approved" };
}

/** submitted|in_review -> rejected. */
export async function rejectSubmissionOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly notes: string },
): Promise<{ status: "rejected" }> {
  await advance(ctx, input.id, ["submitted", "in_review"], {
    status: "rejected",
    decisionAt: sql`now()`,
    decisionNotes: input.notes,
  });
  return { status: "rejected" };
}

/** approved -> funded (the money/credits landed). */
export async function markFundedOp(ctx: MutationContext, input: { readonly id: string }): Promise<{ status: "funded" }> {
  await advance(ctx, input.id, "approved", { status: "funded" });
  return { status: "funded" };
}

/** Any non-terminal state -> withdrawn. */
export async function withdrawSubmissionOp(ctx: MutationContext, input: { readonly id: string }): Promise<{ status: "withdrawn" }> {
  await advance(ctx, input.id, ["draft", "submitted", "in_review", "approved"], { status: "withdrawn" });
  return { status: "withdrawn" };
}

/** Link (or clear) the attributed ACE opportunity. */
export async function linkOpportunityOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly opportunityId: string | null },
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  await loadSubmission(ctx, input.id);
  if (input.opportunityId) await assertOpportunityInTenant(tx, identity.tenantId, input.opportunityId);
  await tx
    .update(fundingSubmissions)
    .set({ opportunityId: input.opportunityId, updatedAt: sql`now()` })
    .where(and(eq(fundingSubmissions.id, input.id), eq(fundingSubmissions.tenantId, identity.tenantId)));
  return { id: input.id };
}
