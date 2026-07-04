"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { createManagedWorkspaceSchema, requestLinkSchema, linkRequestSchema } from "./schemas";
import {
  createManagedWorkspaceOp,
  requestLinkOp,
  approveLinkOp,
  rejectLinkOp,
} from "./operations";

/**
 * Agency / portfolio server actions (Bet C). Validation + idempotency + Next plumbing;
 * the DB work lives in operations.ts. Agency-side writes gate on portfolio:manage;
 * approve/reject gate on settings:manage (the target owner consenting to be managed).
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createManagedWorkspace(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let name = "";
  try {
    const input = parseOrThrow(createManagedWorkspaceSchema, { name: formData.get("name") });
    name = input.name;
    await runMutation({
      permission: "portfolio:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "portfolio.create_workspace",
      resourceType: "tenant",
      resourceId: (r: { tenantId: string }) => r.tenantId,
      auditMetadata: { name: input.name },
      handler: (ctx) => createManagedWorkspaceOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/portfolio");
  return { ok: true, detail: `Created managed workspace "${name}".` };
}

export async function requestLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let slug = "";
  try {
    const input = parseOrThrow(requestLinkSchema, { slug: formData.get("slug") });
    slug = input.slug;
    await runMutation({
      permission: "portfolio:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "portfolio.request_link",
      resourceType: "agency_link_request",
      resourceId: (r: { requestId: string }) => r.requestId,
      auditMetadata: { slug: input.slug },
      handler: (ctx) => requestLinkOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/portfolio");
  return { ok: true, detail: `Requested to manage "${slug}". Awaiting their approval.` };
}

export async function approveLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = parseOrThrow(linkRequestSchema, { requestId: formData.get("requestId") });
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "portfolio.approve_link",
      resourceType: "agency_link_request",
      resourceId: () => input.requestId,
      handler: (ctx) => approveLinkOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true, detail: "Workspace is now managed by the agency." };
}

export async function rejectLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = parseOrThrow(linkRequestSchema, { requestId: formData.get("requestId") });
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "portfolio.reject_link",
      resourceType: "agency_link_request",
      resourceId: () => input.requestId,
      handler: (ctx) => rejectLinkOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true, detail: "Link request declined." };
}
