"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createManagedWorkspaceSchema,
  requestLinkSchema,
  linkRequestSchema,
  setCustomerPlanSchema,
} from "./schemas";
import {
  createManagedWorkspaceOp,
  requestLinkOp,
  approveLinkOp,
  rejectLinkOp,
  setCustomerPlanOp,
} from "./operations";
import { PACKAGE_META, type PackageTier } from "@/domain/packaging/catalog";
import { inviteEmail } from "@/domain/settings/invite-email";
import { sendEmail } from "@/notifications/delivery";
import { env } from "@/env";

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
  let invited: { email: string; role: string }[] = [];
  try {
    const role = String(formData.get("inviteRole") ?? "member");
    const emails = String(formData.get("inviteEmails") ?? "")
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    const input = parseOrThrow(createManagedWorkspaceSchema, {
      name: formData.get("name"),
      initialUsers: emails.map((email) => ({ email, role })),
    });
    name = input.name;
    const res = await runMutation({
      permission: "portfolio:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "portfolio.create_workspace",
      resourceType: "tenant",
      resourceId: (r: { tenantId: string }) => r.tenantId,
      auditMetadata: { name: input.name, invited: input.initialUsers.length },
      handler: (ctx) => createManagedWorkspaceOp(ctx, input),
    });
    invited = res.body.invited;
  } catch (err) {
    return failure(err);
  }
  // Committed; email delivery is best-effort on top (the adapter never throws).
  // Invites are consumed by email match at first sign-in, so a failed send only
  // means telling the invitee out-of-band.
  const origin = new URL(env.OIDC_REDIRECT_URI).origin;
  for (const u of invited) {
    await sendEmail(inviteEmail({ email: u.email, role: u.role, origin }));
  }
  revalidatePath("/portfolio");
  const suffix =
    invited.length > 0 ? ` and invited ${invited.length} teammate${invited.length === 1 ? "" : "s"}` : "";
  return { ok: true, detail: `Created managed workspace "${name}"${suffix}.` };
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

export async function setCustomerPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let plan: PackageTier | "" = "";
  try {
    const input = parseOrThrow(setCustomerPlanSchema, {
      workspaceId: formData.get("workspaceId"),
      plan: formData.get("plan"),
    });
    plan = input.plan;
    await runMutation({
      permission: "billing:set_plan",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "billing.set_plan",
      resourceType: "tenant",
      resourceId: () => input.workspaceId,
      auditMetadata: { workspaceId: input.workspaceId, plan: input.plan },
      handler: (ctx) => setCustomerPlanOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/portfolio");
  return { ok: true, detail: `Service package set to ${PACKAGE_META[plan as PackageTier].label}.` };
}
