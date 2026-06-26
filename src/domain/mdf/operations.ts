import { and, eq, sql } from "drizzle-orm";
import { mdfRequests, users } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { createSourcedTask } from "@/domain/tasks/operations";
import { createSourcedEvidence } from "@/domain/evidence/operations";
import { preflight, type MdfLike } from "@/domain/mdf/analytics";
import type { MdfStatus } from "@/domain/mdf/lifecycle";

/**
 * The database side of MDF Management. Factored out of the actions so the gate
 * drives them in tests. Each lifecycle transition is status-guarded (only the
 * expected prior state advances), so concurrent or replayed transitions can't
 * corrupt the funding state machine.
 */

type ActivityType = "event" | "campaign" | "content" | "enablement" | "other";

async function assertOwnerInTenant(
  tx: MutationContext["tx"],
  tenantId: string,
  ownerUserId: string,
): Promise<void> {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, ownerUserId), eq(users.tenantId, tenantId)));
  if (!owner) throw new ValidationError("Owner is not a member of this workspace");
}

async function loadRequest(
  ctx: MutationContext,
  id: string,
): Promise<typeof mdfRequests.$inferSelect> {
  const [row] = await ctx.tx
    .select()
    .from(mdfRequests)
    .where(and(eq(mdfRequests.id, id), eq(mdfRequests.tenantId, ctx.identity.tenantId)));
  if (!row) throw new ValidationError("MDF request not found");
  return row;
}

export interface CreateRequestInput {
  readonly title: string;
  readonly activityType: ActivityType;
  readonly requestedAmount: number;
  readonly expectedPipeline: number;
  readonly ownerUserId: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly claimDeadline: string | null;
  readonly opportunityRef: string | null;
}

export async function createRequestOp(
  { identity, tx }: MutationContext,
  input: CreateRequestInput,
): Promise<{ id: string }> {
  if (input.ownerUserId) await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);
  const [row] = await tx
    .insert(mdfRequests)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      activityType: input.activityType,
      requestedAmount: input.requestedAmount,
      expectedPipeline: input.expectedPipeline,
      ownerUserId: input.ownerUserId,
      startDate: input.startDate,
      endDate: input.endDate,
      claimDeadline: input.claimDeadline,
      opportunityRef: input.opportunityRef,
      createdBy: identity.userId,
    })
    .returning({ id: mdfRequests.id });
  return { id: row!.id };
}

export interface UpdateRequestInput {
  readonly id: string;
  readonly title?: string;
  readonly activityType?: ActivityType;
  readonly requestedAmount?: number;
  readonly expectedPipeline?: number;
  readonly ownerUserId?: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly claimDeadline?: string | null;
  readonly opportunityRef?: string | null;
}

export async function updateRequestOp(
  ctx: MutationContext,
  input: UpdateRequestInput,
): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  const current = await loadRequest(ctx, input.id);
  if (current.status !== "draft") {
    throw new ValidationError("Only a draft request can be edited");
  }
  if (input.ownerUserId) await assertOwnerInTenant(tx, identity.tenantId, input.ownerUserId);

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.title !== undefined) set.title = input.title;
  if (input.activityType !== undefined) set.activityType = input.activityType;
  if (input.requestedAmount !== undefined) set.requestedAmount = input.requestedAmount;
  if (input.expectedPipeline !== undefined) set.expectedPipeline = input.expectedPipeline;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.startDate !== undefined) set.startDate = input.startDate;
  if (input.endDate !== undefined) set.endDate = input.endDate;
  if (input.claimDeadline !== undefined) set.claimDeadline = input.claimDeadline;
  if (input.opportunityRef !== undefined) set.opportunityRef = input.opportunityRef;

  await tx
    .update(mdfRequests)
    .set(set)
    .where(and(eq(mdfRequests.id, input.id), eq(mdfRequests.tenantId, identity.tenantId)));
  return { id: input.id };
}

/** Guarded status flip from `from` to `to`, with extra fields. */
async function advance(
  ctx: MutationContext,
  id: string,
  from: MdfStatus,
  set: Record<string, unknown>,
): Promise<void> {
  const updated = await ctx.tx
    .update(mdfRequests)
    .set({ ...set, updatedAt: sql`now()` })
    .where(
      and(
        eq(mdfRequests.id, id),
        eq(mdfRequests.tenantId, ctx.identity.tenantId),
        eq(mdfRequests.status, from),
      ),
    )
    .returning({ id: mdfRequests.id });
  if (updated.length === 0) {
    throw new ValidationError(`Request is not in the '${from}' state`);
  }
}

/** draft -> requested. Guarded by the eligibility preflight. */
export async function submitRequestOp(
  ctx: MutationContext,
  input: { readonly id: string },
): Promise<{ status: "requested" }> {
  const req = await loadRequest(ctx, input.id);
  if (!preflight(req as MdfLike).eligible) {
    throw new ValidationError("Request fails eligibility preflight; resolve the open checks first");
  }
  await advance(ctx, input.id, "draft", { status: "requested", submittedAt: sql`now()` });
  return { status: "requested" };
}

/** requested -> approved (the money gate). approvedAmount <= requestedAmount. */
export async function approveRequestOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly approvedAmount: number; readonly notes: string },
): Promise<{ status: "approved" }> {
  const req = await loadRequest(ctx, input.id);
  if (input.approvedAmount <= 0 || input.approvedAmount > req.requestedAmount) {
    throw new ValidationError("Approved amount must be between 1 and the requested amount");
  }
  await advance(ctx, input.id, "requested", {
    status: "approved",
    approvedAmount: input.approvedAmount,
    approvedAt: sql`now()`,
    reviewNotes: input.notes,
  });
  return { status: "approved" };
}

export async function rejectRequestOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly notes: string },
): Promise<{ status: "rejected" }> {
  await advance(ctx, input.id, "requested", { status: "rejected", reviewNotes: input.notes });
  return { status: "rejected" };
}

/** approved -> deployed. deployedAmount <= approvedAmount. */
export async function deployRequestOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly deployedAmount: number },
): Promise<{ status: "deployed" }> {
  const req = await loadRequest(ctx, input.id);
  const approved = req.approvedAmount ?? 0;
  if (input.deployedAmount <= 0 || input.deployedAmount > approved) {
    throw new ValidationError("Deployed amount must be between 1 and the approved amount");
  }
  await advance(ctx, input.id, "approved", { status: "deployed", deployedAmount: input.deployedAmount });
  return { status: "deployed" };
}

/** deployed -> claimed. Requires proof-of-performance evidence; claimed <= deployed. */
export async function claimRequestOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly claimedAmount: number },
): Promise<{ status: "claimed" }> {
  const req = await loadRequest(ctx, input.id);
  if (req.evidenceId === null) {
    throw new ValidationError("Attach proof-of-performance evidence before claiming");
  }
  const deployed = req.deployedAmount ?? 0;
  if (input.claimedAmount <= 0 || input.claimedAmount > deployed) {
    throw new ValidationError("Claimed amount must be between 1 and the deployed amount");
  }
  await advance(ctx, input.id, "deployed", { status: "claimed", claimedAmount: input.claimedAmount });
  return { status: "claimed" };
}

/** claimed -> reimbursed. reimbursedAmount <= claimedAmount. */
export async function reimburseRequestOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly reimbursedAmount: number },
): Promise<{ status: "reimbursed" }> {
  const req = await loadRequest(ctx, input.id);
  const claimed = req.claimedAmount ?? 0;
  if (input.reimbursedAmount <= 0 || input.reimbursedAmount > claimed) {
    throw new ValidationError("Reimbursed amount must be between 1 and the claimed amount");
  }
  await advance(ctx, input.id, "claimed", { status: "reimbursed", reimbursedAmount: input.reimbursedAmount });
  return { status: "reimbursed" };
}

/** Stage a proof-of-performance evidence record and link it to the request. */
export async function stageProofEvidenceOp(
  ctx: MutationContext,
  input: { readonly id: string },
): Promise<{ evidenceId: string | null }> {
  const req = await loadRequest(ctx, input.id);
  const { evidenceId } = await createSourcedEvidence(ctx, {
    title: `MDF proof: ${req.title}`,
    evidenceType: "billing",
    program: "MDF proof of performance",
    notes: "",
    source: "mdf",
    sourceRef: req.id,
  });
  if (evidenceId) {
    await ctx.tx
      .update(mdfRequests)
      .set({ evidenceId, updatedAt: sql`now()` })
      .where(and(eq(mdfRequests.id, input.id), eq(mdfRequests.tenantId, ctx.identity.tenantId)));
  }
  return { evidenceId };
}

/** Create a Task Manager task for the request and link it back. */
export async function createTaskFromRequestOp(
  ctx: MutationContext,
  input: { readonly id: string },
): Promise<{ taskId: string | null }> {
  const req = await loadRequest(ctx, input.id);
  const { taskId } = await createSourcedTask(ctx, {
    title: `MDF: ${req.title}`,
    description: `Execute the MDF activity and collect proof of performance.`,
    priority: "medium",
    source: "mdf",
    sourceRef: req.id,
    ownerUserId: req.ownerUserId,
  });
  if (taskId) {
    await ctx.tx
      .update(mdfRequests)
      .set({ taskId, updatedAt: sql`now()` })
      .where(and(eq(mdfRequests.id, input.id), eq(mdfRequests.tenantId, ctx.identity.tenantId)));
  }
  return { taskId };
}
