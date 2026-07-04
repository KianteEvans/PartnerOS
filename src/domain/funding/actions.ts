"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createSubmissionSchema,
  updateSubmissionSchema,
  submissionIdSchema,
  approveSchema,
  notesSchema,
} from "@/domain/funding/schemas";
import {
  createSubmissionOp,
  updateSubmissionOp,
  submitSubmissionOp,
  startReviewOp,
  approveSubmissionOp,
  rejectSubmissionOp,
  markFundedOp,
  withdrawSubmissionOp,
} from "@/domain/funding/operations";

/**
 * AWS Funding server actions: validation, idempotency, and Next plumbing only. create/
 * edit use a rotated per-form client token; the lifecycle transitions use deterministic
 * keys (each is once-per-state and the ops status-guard). DB work lives in operations.ts.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function sid(formData: FormData): string {
  return parseOrThrow(submissionIdSchema, { submissionId: formData.get("submissionId") }).submissionId;
}

export async function createFundingSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(createSubmissionSchema, {
      programKey: formData.get("programKey"),
      title: formData.get("title"),
      fundingType: formData.get("fundingType"),
      requestedAmount: formData.get("requestedAmount"),
      workloadType: formData.get("workloadType"),
      customerSegment: formData.get("customerSegment"),
      opportunityId: formData.get("opportunityId"),
      deadline: formData.get("deadline"),
      externalRef: formData.get("externalRef"),
    });
    const res = await runMutation({
      permission: "funding:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "funding.create",
      resourceType: "funding_submission",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { programKey: input.programKey, requestedAmount: input.requestedAmount },
      handler: (ctx) => createSubmissionOp(ctx, { ...input, ownerUserId: null }),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/funding/submissions");
  redirect(`/funding/submissions/${newId}`);
}

export async function updateFundingSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let submissionId = "";
  try {
    submissionId = sid(formData);
    const input = parseOrThrow(updateSubmissionSchema, {
      title: formData.get("title"),
      fundingType: formData.get("fundingType"),
      requestedAmount: formData.get("requestedAmount"),
      workloadType: formData.get("workloadType"),
      customerSegment: formData.get("customerSegment"),
      opportunityId: formData.get("opportunityId"),
      deadline: formData.get("deadline"),
      externalRef: formData.get("externalRef"),
    });
    await runMutation({
      permission: "funding:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ id: submissionId, ...input }),
      action: "funding.update",
      resourceType: "funding_submission",
      resourceId: () => submissionId,
      handler: (ctx) => updateSubmissionOp(ctx, { id: submissionId, ...input }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/funding/submissions/${submissionId}`);
  return { ok: true };
}

/** Shared wrapper for lifecycle transitions — parse id, run, revalidate. */
async function runTransition(formData: FormData, run: (id: string) => Promise<unknown>): Promise<ActionState> {
  let submissionId = "";
  try {
    submissionId = sid(formData);
    await run(submissionId);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/funding/submissions/${submissionId}`);
  revalidatePath("/funding/submissions");
  return { ok: true };
}

export async function submitFundingSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "funding:submit",
      idempotencyKey: `submit-funding:${id}`,
      rawBody: JSON.stringify({ id }),
      action: "funding.submit",
      resourceType: "funding_submission",
      resourceId: () => id,
      handler: (ctx) => submitSubmissionOp(ctx, { id }),
    }),
  );
}

export async function startFundingReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "funding:approve",
      idempotencyKey: `review-funding:${id}`,
      rawBody: JSON.stringify({ id }),
      action: "funding.review",
      resourceType: "funding_submission",
      resourceId: () => id,
      handler: (ctx) => startReviewOp(ctx, { id }),
    }),
  );
}

export async function approveFundingSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseOrThrow(approveSchema, {
    approvedAmount: formData.get("approvedAmount"),
    notes: formData.get("notes"),
  });
  return runTransition(formData, (id) =>
    runMutation({
      permission: "funding:approve",
      idempotencyKey: `approve-funding:${id}`,
      rawBody: JSON.stringify({ id, ...parsed }),
      action: "funding.approve",
      resourceType: "funding_submission",
      resourceId: () => id,
      auditMetadata: { approvedAmount: parsed.approvedAmount },
      handler: (ctx) => approveSubmissionOp(ctx, { id, approvedAmount: parsed.approvedAmount, notes: parsed.notes }),
    }),
  );
}

export async function rejectFundingSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseOrThrow(notesSchema, { notes: formData.get("notes") });
  return runTransition(formData, (id) =>
    runMutation({
      permission: "funding:approve",
      idempotencyKey: `reject-funding:${id}`,
      rawBody: JSON.stringify({ id, ...parsed }),
      action: "funding.reject",
      resourceType: "funding_submission",
      resourceId: () => id,
      handler: (ctx) => rejectSubmissionOp(ctx, { id, notes: parsed.notes }),
    }),
  );
}

export async function markFundingFunded(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "funding:approve",
      idempotencyKey: `fund-funding:${id}`,
      rawBody: JSON.stringify({ id }),
      action: "funding.funded",
      resourceType: "funding_submission",
      resourceId: () => id,
      handler: (ctx) => markFundedOp(ctx, { id }),
    }),
  );
}

export async function withdrawFundingSubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "funding:update",
      idempotencyKey: `withdraw-funding:${id}`,
      rawBody: JSON.stringify({ id }),
      action: "funding.withdraw",
      resourceType: "funding_submission",
      resourceId: () => id,
      handler: (ctx) => withdrawSubmissionOp(ctx, { id }),
    }),
  );
}
