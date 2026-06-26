"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createRequestSchema,
  requestIdSchema,
  positiveAmount,
} from "@/domain/mdf/schemas";
import {
  createRequestOp,
  updateRequestOp,
  submitRequestOp,
  approveRequestOp,
  rejectRequestOp,
  deployRequestOp,
  claimRequestOp,
  reimburseRequestOp,
  stageProofEvidenceOp,
  createTaskFromRequestOp,
} from "@/domain/mdf/operations";

/**
 * MDF server actions: validation, idempotency, and Next plumbing only. create/
 * edit use a rotated per-form client token; the lifecycle transitions use
 * deterministic keys (each is once-per-state and the ops status-guard). DB work
 * lives in operations.ts.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function rid(formData: FormData): string {
  return parseOrThrow(requestIdSchema, { requestId: formData.get("requestId") }).requestId;
}

function amountOf(formData: FormData, field: string): number {
  return parseOrThrow(positiveAmount, formData.get(field));
}

export async function createMdfRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(createRequestSchema, {
      title: formData.get("title"),
      activityType: formData.get("activityType"),
      requestedAmount: formData.get("requestedAmount"),
      expectedPipeline: formData.get("expectedPipeline"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      claimDeadline: formData.get("claimDeadline"),
      opportunityRef: formData.get("opportunityRef"),
    });
    const res = await runMutation({
      permission: "mdf:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "mdf.create",
      resourceType: "mdf_request",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { requestedAmount: input.requestedAmount },
      handler: (ctx) => createRequestOp(ctx, { ...input, ownerUserId: null }),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/mdf");
  redirect(`/mdf/${newId}`);
}

export async function updateMdfRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let requestId = "";
  try {
    requestId = rid(formData);
    const input = parseOrThrow(createRequestSchema, {
      title: formData.get("title"),
      activityType: formData.get("activityType"),
      requestedAmount: formData.get("requestedAmount"),
      expectedPipeline: formData.get("expectedPipeline"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      claimDeadline: formData.get("claimDeadline"),
      opportunityRef: formData.get("opportunityRef"),
    });
    const owner = String(formData.get("ownerUserId") ?? "");
    await runMutation({
      permission: "mdf:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ requestId, ...input, owner }),
      action: "mdf.update",
      resourceType: "mdf_request",
      resourceId: () => requestId,
      handler: (ctx) =>
        updateRequestOp(ctx, { id: requestId, ...input, ownerUserId: owner.length > 0 ? owner : null }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/${requestId}`);
  return { ok: true };
}

/**
 * Build a gated lifecycle action: parse the request id, run the transition (the
 * closure owns its permission/key/handler), and revalidate. Errors surface as
 * ActionState; the ops status-guard each transition.
 */
/**
 * Shared wrapper for the lifecycle transitions: parse the request id, run the
 * transition (the closure owns its permission/key/handler), and revalidate.
 * Not itself a Server Action — each export below is a literal async function, as
 * the "use server" compiler requires.
 */
async function runTransition(
  formData: FormData,
  run: (requestId: string) => Promise<unknown>,
): Promise<ActionState> {
  let requestId = "";
  try {
    requestId = rid(formData);
    await run(requestId);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/${requestId}`);
  revalidatePath("/mdf");
  return { ok: true };
}

export async function submitMdfRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "mdf:update",
      idempotencyKey: `submit-mdf:${id}`,
      rawBody: JSON.stringify({ id }),
      action: "mdf.submit",
      resourceType: "mdf_request",
      resourceId: () => id,
      handler: (ctx) => submitRequestOp(ctx, { id }),
    }),
  );
}

export async function approveMdfRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "mdf:approve",
      idempotencyKey: `approve-mdf:${id}`,
      rawBody: JSON.stringify({ id, approvedAmount: String(formData.get("approvedAmount")) }),
      action: "mdf.approve",
      resourceType: "mdf_request",
      resourceId: () => id,
      auditMetadata: { event: "mdf_approved" },
      handler: (ctx) =>
        approveRequestOp(ctx, {
          id,
          approvedAmount: amountOf(formData, "approvedAmount"),
          notes: String(formData.get("notes") ?? "").slice(0, 2000),
        }),
    }),
  );
}

export async function rejectMdfRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "mdf:approve",
      idempotencyKey: `reject-mdf:${id}`,
      rawBody: JSON.stringify({ id }),
      action: "mdf.reject",
      resourceType: "mdf_request",
      resourceId: () => id,
      handler: (ctx) => rejectRequestOp(ctx, { id, notes: String(formData.get("notes") ?? "").slice(0, 2000) }),
    }),
  );
}

export async function deployMdfRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "mdf:update",
      idempotencyKey: `deploy-mdf:${id}`,
      rawBody: JSON.stringify({ id, deployedAmount: String(formData.get("deployedAmount")) }),
      action: "mdf.deploy",
      resourceType: "mdf_request",
      resourceId: () => id,
      handler: (ctx) => deployRequestOp(ctx, { id, deployedAmount: amountOf(formData, "deployedAmount") }),
    }),
  );
}

export async function claimMdfRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "mdf:update",
      idempotencyKey: `claim-mdf:${id}`,
      rawBody: JSON.stringify({ id, claimedAmount: String(formData.get("claimedAmount")) }),
      action: "mdf.claim",
      resourceType: "mdf_request",
      resourceId: () => id,
      handler: (ctx) => claimRequestOp(ctx, { id, claimedAmount: amountOf(formData, "claimedAmount") }),
    }),
  );
}

export async function reimburseMdfRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runTransition(formData, (id) =>
    runMutation({
      permission: "mdf:update",
      idempotencyKey: `reimburse-mdf:${id}`,
      rawBody: JSON.stringify({ id, reimbursedAmount: String(formData.get("reimbursedAmount")) }),
      action: "mdf.reimburse",
      resourceType: "mdf_request",
      resourceId: () => id,
      handler: (ctx) => reimburseRequestOp(ctx, { id, reimbursedAmount: amountOf(formData, "reimbursedAmount") }),
    }),
  );
}

export async function stageMdfProof(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let requestId = "";
  try {
    requestId = rid(formData);
    await runMutation({
      permission: "mdf:update",
      idempotencyKey: `mdf-proof:${requestId}`,
      rawBody: JSON.stringify({ id: requestId }),
      action: "mdf.stage_proof",
      resourceType: "mdf_request",
      resourceId: () => requestId,
      handler: (ctx) => stageProofEvidenceOp(ctx, { id: requestId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/${requestId}`);
  revalidatePath("/evidence");
  return { ok: true };
}

export async function createMdfTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let requestId = "";
  try {
    requestId = rid(formData);
    await runMutation({
      permission: "mdf:update",
      idempotencyKey: `mdf-task:${requestId}`,
      rawBody: JSON.stringify({ id: requestId }),
      action: "mdf.create_task",
      resourceType: "mdf_request",
      resourceId: () => requestId,
      handler: (ctx) => createTaskFromRequestOp(ctx, { id: requestId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/mdf/${requestId}`);
  revalidatePath("/tasks");
  return { ok: true };
}
