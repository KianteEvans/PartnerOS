import { and, eq, inArray, sql } from "drizzle-orm";
import { mdfBudgets, mdfRequests, users } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { createSourcedTask } from "@/domain/tasks/operations";
import { createSourcedEvidence } from "@/domain/evidence/operations";
import { preflight, type MdfLike } from "@/domain/mdf/analytics";
import { complianceChecks } from "@/domain/mdf/compliance";
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
  readonly catalogKey?: string | null;
  readonly totalCost?: number | null;
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
      catalogKey: input.catalogKey ?? null,
      totalCost: input.totalCost ?? null,
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
  readonly catalogKey?: string | null;
  readonly totalCost?: number | null;
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
  if (input.catalogKey !== undefined) set.catalogKey = input.catalogKey;
  if (input.totalCost !== undefined) set.totalCost = input.totalCost;

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

/** draft -> requested. Guarded by the eligibility preflight + AWS hard rules. */
export async function submitRequestOp(
  ctx: MutationContext,
  input: { readonly id: string; readonly today: string },
): Promise<{ status: "requested" }> {
  const req = await loadRequest(ctx, input.id);
  if (!preflight(req as MdfLike).eligible) {
    throw new ValidationError("Request fails eligibility preflight; resolve the open checks first");
  }
  // When grounded in the AWS activity catalog, also enforce the hard AWS rules
  // (ineligible activity, dates crossing calendar years, past the Dec 1 cutoff).
  if (req.catalogKey) {
    const block = complianceChecks(
      {
        catalogKey: req.catalogKey,
        startDate: req.startDate,
        endDate: req.endDate,
        totalCost: req.totalCost ?? req.requestedAmount,
        coFundPct: 50,
        brandingConfirmed: req.awsBrandingConfirmed,
      },
      input.today,
    ).find((c) => c.severity === "block");
    if (block) throw new ValidationError(`AWS rules block this request: ${block.message}`);
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
    description: req.claimDeadline
      ? `Execute the MDF activity, collect proof of performance, and submit the claim by ${req.claimDeadline}.`
      : `Execute the MDF activity and collect proof of performance.`,
    priority: "medium",
    source: "mdf",
    sourceRef: req.id,
    ownerUserId: req.ownerUserId,
    dueDate: req.claimDeadline,
  });
  if (taskId) {
    await ctx.tx
      .update(mdfRequests)
      .set({ taskId, updatedAt: sql`now()` })
      .where(and(eq(mdfRequests.id, input.id), eq(mdfRequests.tenantId, ctx.identity.tenantId)));
  }
  return { taskId };
}

/**
 * Bulk-approve `requested` rows at their full requested amount. The `requested`
 * status guard means non-requested ids are silently skipped (count reflects what
 * actually advanced), and the SQL `requested_amount` reference approves each row
 * at its own ask in a single statement. Per-amount transitions (deploy/claim/
 * reimburse) are intentionally NOT bulkable — they need a per-row figure.
 */
export async function bulkApproveMdfOp(
  { identity, tx }: MutationContext,
  input: { readonly ids: readonly string[]; readonly notes: string },
): Promise<{ count: number }> {
  if (input.ids.length === 0) throw new ValidationError("No rows selected");
  const updated = await tx
    .update(mdfRequests)
    .set({
      status: "approved",
      approvedAmount: sql`${mdfRequests.requestedAmount}`,
      approvedAt: sql`now()`,
      reviewNotes: input.notes,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(mdfRequests.id, [...input.ids]),
        eq(mdfRequests.tenantId, identity.tenantId),
        eq(mdfRequests.status, "requested"),
      ),
    )
    .returning({ id: mdfRequests.id });
  return { count: updated.length };
}

/** Bulk-reject `requested` rows (status-guarded; non-requested ids are skipped). */
export async function bulkRejectMdfOp(
  { identity, tx }: MutationContext,
  input: { readonly ids: readonly string[]; readonly notes: string },
): Promise<{ count: number }> {
  if (input.ids.length === 0) throw new ValidationError("No rows selected");
  const updated = await tx
    .update(mdfRequests)
    .set({ status: "rejected", reviewNotes: input.notes, updatedAt: sql`now()` })
    .where(
      and(
        inArray(mdfRequests.id, [...input.ids]),
        eq(mdfRequests.tenantId, identity.tenantId),
        eq(mdfRequests.status, "requested"),
      ),
    )
    .returning({ id: mdfRequests.id });
  return { count: updated.length };
}

export interface BudgetInput {
  readonly periodLabel: string;
  readonly amount: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** Create a per-period MDF budget allocation. Managerial — gated on mdf:approve. */
export async function createBudgetOp(
  { identity, tx }: MutationContext,
  input: BudgetInput,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(mdfBudgets)
    .values({
      tenantId: identity.tenantId,
      periodLabel: input.periodLabel,
      amount: input.amount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      createdBy: identity.userId,
    })
    .returning({ id: mdfBudgets.id });
  return { id: row!.id };
}

/** Update an existing budget allocation. */
export async function updateBudgetOp(
  { identity, tx }: MutationContext,
  input: BudgetInput & { readonly id: string },
): Promise<{ id: string }> {
  const updated = await tx
    .update(mdfBudgets)
    .set({
      periodLabel: input.periodLabel,
      amount: input.amount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      updatedAt: sql`now()`,
    })
    .where(and(eq(mdfBudgets.id, input.id), eq(mdfBudgets.tenantId, identity.tenantId)))
    .returning({ id: mdfBudgets.id });
  if (updated.length === 0) throw new ValidationError("Budget not found");
  return { id: input.id };
}
