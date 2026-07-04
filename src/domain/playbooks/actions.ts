"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createPlaybookSchema,
  updatePlaybookSchema,
  playbookIdSchema,
  togglePlaybookSchema,
  runIdSchema,
  notificationIdSchema,
  webhookSchema,
  webhookIdSchema,
  webhookToggleSchema,
} from "./schemas";
import {
  createPlaybookOp,
  updatePlaybookOp,
  deletePlaybookOp,
  approveRunOp,
  dismissRunOp,
  markNotificationReadOp,
  createWebhookOp,
  setWebhookEnabledOp,
  deleteWebhookOp,
} from "./operations";
import type { NotifyChannel, PlaybookActionType } from "./catalog";

/**
 * Playbook server actions: validation, idempotency, and Next plumbing only. The
 * engine's execution + governance live in operations.ts. Lifecycle actions use
 * deterministic idempotency keys (once-per-run, guarded by the op).
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createPlaybook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = parseOrThrow(createPlaybookSchema, {
      name: formData.get("name"),
      description: formData.get("description"),
      triggerSituation: formData.get("triggerSituation"),
      triggerMinSeverity: formData.get("triggerMinSeverity"),
      actionType: formData.get("actionType"),
      title: formData.get("title"),
      priority: formData.get("priority"),
      ownerUserId: formData.get("ownerUserId"),
      cap: formData.get("cap"),
      channels: formData.getAll("channels"),
    });
    const actionType = input.actionType as PlaybookActionType;
    const actionParams: Record<string, unknown> = {};
    if (input.title) actionParams.title = input.title;
    if (actionType === "create_task") actionParams.priority = input.priority;
    if (actionType === "route_opportunity") actionParams.ownerUserId = input.ownerUserId;
    if (actionType === "approve_within_cap") actionParams.cap = input.cap;

    await runMutation({
      permission: "playbook:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "playbook.create",
      resourceType: "playbook",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { situation: input.triggerSituation, actionType },
      handler: (ctx) =>
        createPlaybookOp(ctx, {
          name: input.name,
          description: input.description,
          enabled: true,
          triggerSituation: input.triggerSituation,
          triggerMinSeverity: input.triggerMinSeverity,
          actionType,
          actionParams,
          channels: input.channels as NotifyChannel[],
        }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks");
  redirect("/playbooks");
}

export async function updatePlaybook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { playbookId } = parseOrThrow(playbookIdSchema, { playbookId: formData.get("playbookId") });
    const input = parseOrThrow(updatePlaybookSchema, {
      name: formData.get("name"),
      description: formData.get("description"),
      triggerMinSeverity: formData.get("triggerMinSeverity"),
      channels: formData.getAll("channels"),
    });
    await runMutation({
      permission: "playbook:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ playbookId, ...input }),
      action: "playbook.update",
      resourceType: "playbook",
      resourceId: () => playbookId,
      handler: (ctx) =>
        updatePlaybookOp(ctx, {
          id: playbookId,
          name: input.name,
          description: input.description,
          triggerMinSeverity: input.triggerMinSeverity,
          channels: input.channels as NotifyChannel[],
        }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks");
  return { ok: true };
}

export async function togglePlaybook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { playbookId, enabled } = parseOrThrow(togglePlaybookSchema, {
      playbookId: formData.get("playbookId"),
      enabled: formData.get("enabled"),
    });
    await runMutation({
      permission: "playbook:update",
      idempotencyKey: `toggle-playbook:${playbookId}:${enabled}`,
      rawBody: JSON.stringify({ playbookId, enabled }),
      action: "playbook.toggle",
      resourceType: "playbook",
      resourceId: () => playbookId,
      handler: (ctx) => updatePlaybookOp(ctx, { id: playbookId, enabled }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks");
  return { ok: true };
}

export async function deletePlaybook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { playbookId } = parseOrThrow(playbookIdSchema, { playbookId: formData.get("playbookId") });
    await runMutation({
      permission: "playbook:delete",
      idempotencyKey: `delete-playbook:${playbookId}`,
      rawBody: JSON.stringify({ playbookId }),
      action: "playbook.delete",
      resourceType: "playbook",
      resourceId: () => playbookId,
      handler: (ctx) => deletePlaybookOp(ctx, { id: playbookId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks");
  return { ok: true };
}

export async function approvePlaybookRun(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { runId } = parseOrThrow(runIdSchema, { runId: formData.get("runId") });
    await runMutation({
      permission: "playbook:approve",
      idempotencyKey: `approve-run:${runId}`,
      rawBody: JSON.stringify({ runId }),
      action: "playbook.run.approve",
      resourceType: "playbook_run",
      resourceId: () => runId,
      handler: (ctx) => approveRunOp(ctx, { runId, today: today() }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks/activity");
  return { ok: true };
}

export async function dismissPlaybookRun(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { runId } = parseOrThrow(runIdSchema, { runId: formData.get("runId") });
    await runMutation({
      permission: "playbook:approve",
      idempotencyKey: `dismiss-run:${runId}`,
      rawBody: JSON.stringify({ runId }),
      action: "playbook.run.dismiss",
      resourceType: "playbook_run",
      resourceId: () => runId,
      handler: (ctx) => dismissRunOp(ctx, { runId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks/activity");
  return { ok: true };
}

export async function markNotificationRead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { notificationId } = parseOrThrow(notificationIdSchema, { notificationId: formData.get("notificationId") });
    await runMutation({
      permission: "notification:read",
      idempotencyKey: `read-notification:${notificationId}`,
      rawBody: JSON.stringify({ notificationId }),
      action: "notification.read",
      resourceType: "notification",
      resourceId: () => notificationId,
      handler: (ctx) => markNotificationReadOp(ctx, { id: notificationId }),
    });
  } catch (err) {
    return failure(err);
  }
  return { ok: true };
}

export async function createWebhook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = parseOrThrow(webhookSchema, { url: formData.get("url"), secret: formData.get("secret") });
    await runMutation({
      permission: "playbook:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "notification_webhook.create",
      resourceType: "notification_webhook",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => createWebhookOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks/channels");
  return { ok: true };
}

export async function toggleWebhook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { webhookId, enabled } = parseOrThrow(webhookToggleSchema, {
      webhookId: formData.get("webhookId"),
      enabled: formData.get("enabled"),
    });
    await runMutation({
      permission: "playbook:update",
      idempotencyKey: `toggle-webhook:${webhookId}:${enabled}`,
      rawBody: JSON.stringify({ webhookId, enabled }),
      action: "notification_webhook.toggle",
      resourceType: "notification_webhook",
      resourceId: () => webhookId,
      handler: (ctx) => setWebhookEnabledOp(ctx, { id: webhookId, enabled }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks/channels");
  return { ok: true };
}

export async function deleteWebhook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { webhookId } = parseOrThrow(webhookIdSchema, { webhookId: formData.get("webhookId") });
    await runMutation({
      permission: "playbook:update",
      idempotencyKey: `delete-webhook:${webhookId}`,
      rawBody: JSON.stringify({ webhookId }),
      action: "notification_webhook.delete",
      resourceType: "notification_webhook",
      resourceId: () => webhookId,
      handler: (ctx) => deleteWebhookOp(ctx, { id: webhookId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/playbooks/channels");
  return { ok: true };
}
