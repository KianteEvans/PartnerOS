"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  workspaceSettingsSchema,
  userRoleSchema,
  userStatusSchema,
  inviteUserSchema,
  revokeInvitationSchema,
  revokeSessionsSchema,
  configureConnectorSchema,
  connectorKindEnum,
  connectorStatusEnum,
} from "@/domain/settings/schemas";
import {
  updateWorkspaceSettingsOp,
  updateUserRoleOp,
  setUserStatusOp,
  inviteUserOp,
  revokeInvitationOp,
  revokeUserSessionsOp,
  eraseUserOp,
  configureConnectorOp,
  setConnectorStatusOp,
  syncConnectorOp,
} from "@/domain/settings/operations";

/**
 * Settings server actions: validation, idempotency, and Next plumbing only.
 * Workspace/connector edits use a rotated per-form client token; role changes
 * use the existing user:update permission. DB work lives in operations.ts.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function updateWorkspaceSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(workspaceSettingsSchema, {
      displayName: formData.get("displayName"),
      automationMode: formData.get("automationMode"),
      emailNotifications: formData.get("emailNotifications"),
    });
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "settings.update_workspace",
      resourceType: "workspace_settings",
      auditMetadata: { automationMode: input.automationMode },
      handler: (ctx) => updateWorkspaceSettingsOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateUserRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const change = parseOrThrow(userRoleSchema, {
      userId: formData.get("userId"),
      role: formData.get("role"),
    });
    await runMutation({
      permission: "user:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(change),
      action: "settings.update_role",
      resourceType: "user",
      resourceId: () => change.userId,
      auditMetadata: { role: change.role },
      handler: (ctx) => updateUserRoleOp(ctx, change),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function setUserStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const change = parseOrThrow(userStatusSchema, {
      userId: formData.get("userId"),
      status: formData.get("status"),
    });
    await runMutation({
      permission: "user:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(change),
      action: "settings.set_user_status",
      resourceType: "user",
      resourceId: () => change.userId,
      auditMetadata: { status: change.status },
      handler: (ctx) => setUserStatusOp(ctx, change),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function inviteUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const payload = parseOrThrow(inviteUserSchema, {
      email: formData.get("email"),
      role: formData.get("role"),
    });
    await runMutation({
      permission: "user:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(payload),
      action: "settings.invite_user",
      resourceType: "invitation",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { email: payload.email, role: payload.role },
      handler: (ctx) => inviteUserOp(ctx, payload),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function revokeInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(revokeInvitationSchema, {
      invitationId: formData.get("invitationId"),
    });
    await runMutation({
      permission: "user:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "settings.revoke_invitation",
      resourceType: "invitation",
      resourceId: () => input.invitationId,
      handler: (ctx) => revokeInvitationOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function revokeUserSessions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const change = parseOrThrow(revokeSessionsSchema, {
      userId: formData.get("userId"),
    });
    await runMutation({
      permission: "user:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(change),
      action: "settings.revoke_sessions",
      resourceType: "user",
      resourceId: () => change.userId,
      handler: (ctx) => revokeUserSessionsOp(ctx, change),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function eraseUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const change = parseOrThrow(revokeSessionsSchema, {
      userId: formData.get("userId"),
    });
    await runMutation({
      permission: "user:erase",
      // Deterministic key: erasure is a one-time, irreversible action per user.
      idempotencyKey: `erase-user:${change.userId}`,
      rawBody: JSON.stringify(change),
      action: "settings.erase_user",
      resourceType: "user",
      resourceId: () => change.userId,
      handler: (ctx) => eraseUserOp(ctx, change),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function configureConnector(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(configureConnectorSchema, {
      kind: formData.get("kind"),
      endpoint: formData.get("endpoint"),
      authMode: formData.get("authMode"),
    });
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "settings.configure_connector",
      resourceType: "connector",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { kind: input.kind },
      handler: (ctx) => configureConnectorOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function setConnectorStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const kind = parseOrThrow(connectorKindEnum, formData.get("kind"));
    const status = parseOrThrow(connectorStatusEnum, formData.get("status"));
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: `connector-status:${kind}:${status}`,
      rawBody: JSON.stringify({ kind, status }),
      action: "settings.set_connector_status",
      resourceType: "connector",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => setConnectorStatusOp(ctx, { kind, status }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function syncConnector(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const kind = parseOrThrow(connectorKindEnum, formData.get("kind"));
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ kind }),
      action: "settings.sync_connector",
      resourceType: "connector",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { kind },
      handler: (ctx) => syncConnectorOp(ctx, { kind }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  return { ok: true };
}
