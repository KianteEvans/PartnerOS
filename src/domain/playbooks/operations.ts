import { and, eq, sql } from "drizzle-orm";
import {
  playbooks,
  playbookRuns,
  notifications,
  notificationWebhooks,
  mdfRequests,
  fundingSubmissions,
} from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { can } from "@/authz/permissions";
import type { AutomationMode } from "@/domain/settings/automation";
import type { Decision } from "@/domain/command/brief";
import { evaluatePlaybooks, type PlaybookLike } from "./evaluate";
import { actionAppliesTo, basePermissionFor, type NotifyChannel, type PlaybookActionType } from "./catalog";
import { renderNotification } from "@/domain/notifications/deliver";
import { createTaskOp } from "@/domain/tasks/operations";
import { updateOpportunityOp } from "@/domain/ace/operations";
import { approveRequestOp } from "@/domain/mdf/operations";
import { approveSubmissionOp } from "@/domain/funding/operations";
import { generateReportOp } from "@/domain/reports/operations";

/**
 * The database + orchestration side of the playbook engine. Rules are evaluated
 * (pure) into planned runs, persisted fire-once, and — for `auto` verdicts —
 * dispatched immediately to the EXISTING domain ops (task/route/approve/report/
 * notify). The runner never re-implements action logic; it composes ops. Every
 * dispatch is pre-authorized: createPlaybookOp asserts the creator holds the
 * action's base permission, so unattended runs are safe.
 */

type Priority = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export interface CreatePlaybookInput {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly triggerSituation: string;
  readonly triggerMinSeverity: string;
  readonly actionType: PlaybookActionType;
  readonly actionParams: Record<string, unknown>;
  readonly channels: NotifyChannel[];
}

export async function createPlaybookOp(
  { identity, tx }: MutationContext,
  input: CreatePlaybookInput,
): Promise<{ id: string }> {
  if (!actionAppliesTo(input.actionType, input.triggerSituation)) {
    throw new ValidationError("That action cannot respond to that trigger");
  }
  // Pre-authorization: the creator must be able to perform this action manually,
  // so any later unattended (auto) run is backed by a permitted human.
  const base = basePermissionFor(input.actionType, input.triggerSituation);
  if (!can(identity.role, base)) {
    throw new ValidationError(`You lack the permission (${base}) to automate this action`);
  }
  const [row] = await tx
    .insert(playbooks)
    .values({
      tenantId: identity.tenantId,
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      triggerSituation: input.triggerSituation,
      triggerMinSeverity: input.triggerMinSeverity,
      actionType: input.actionType,
      actionParams: input.actionParams,
      channels: input.channels,
      createdBy: identity.userId,
    })
    .returning({ id: playbooks.id });
  return { id: row!.id };
}

export interface UpdatePlaybookInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly triggerMinSeverity?: string;
  readonly actionParams?: Record<string, unknown>;
  readonly channels?: NotifyChannel[];
}

export async function updatePlaybookOp(ctx: MutationContext, input: UpdatePlaybookInput): Promise<{ id: string }> {
  const { identity, tx } = ctx;
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  if (input.enabled !== undefined) set.enabled = input.enabled;
  if (input.triggerMinSeverity !== undefined) set.triggerMinSeverity = input.triggerMinSeverity;
  if (input.actionParams !== undefined) set.actionParams = input.actionParams;
  if (input.channels !== undefined) set.channels = input.channels;
  await tx
    .update(playbooks)
    .set(set)
    .where(and(eq(playbooks.id, input.id), eq(playbooks.tenantId, identity.tenantId)));
  return { id: input.id };
}

export async function deletePlaybookOp({ identity, tx }: MutationContext, input: { readonly id: string }): Promise<{ id: string }> {
  await tx.delete(playbooks).where(and(eq(playbooks.id, input.id), eq(playbooks.tenantId, identity.tenantId)));
  return { id: input.id };
}

// ---------------------------------------------------------------------------
// Materialize + dispatch
// ---------------------------------------------------------------------------
function entityIdFrom(decisionId: string, prefix: string): string | null {
  return decisionId.startsWith(prefix) ? decisionId.slice(prefix.length) : null;
}

/** Dispatch a planned/approved run to the matching existing op. Returns the op result. */
async function dispatchAction(
  ctx: MutationContext,
  run: { decision: Decision; actionType: PlaybookActionType; actionParams: Record<string, unknown>; channels: NotifyChannel[] },
  opts: { today: string; playbookId: string; playbookName: string; runId: string },
): Promise<Record<string, unknown>> {
  const d = run.decision;
  const p = run.actionParams;
  switch (run.actionType) {
    case "create_task": {
      const r = await createTaskOp(ctx, {
        title: (typeof p.title === "string" && p.title) || `Follow up: ${d.title}`,
        description: d.detail,
        priority: (p.priority as Priority) ?? "medium",
        ownerUserId: (p.ownerUserId as string | undefined) ?? d.ownerUserId ?? null,
        dueDate: d.dueDate,
      });
      return { taskId: r.id };
    }
    case "route_opportunity": {
      const oppId = entityIdFrom(d.id, "opp-");
      if (!oppId) throw new ValidationError("Decision has no routable opportunity");
      const owner = p.ownerUserId as string | undefined;
      if (!owner) throw new ValidationError("route_opportunity needs an ownerUserId param");
      await updateOpportunityOp(ctx, { id: oppId, ownerUserId: owner });
      return { opportunityId: oppId, ownerUserId: owner };
    }
    case "approve_within_cap": {
      const cap = Number(p.cap ?? 0);
      const notes = `Auto-approved by playbook "${opts.playbookName}" (cap ${cap}).`;
      if (d.situation === "funding_deadline") {
        const id = entityIdFrom(d.id, "funding-");
        if (!id) throw new ValidationError("Decision has no funding submission");
        const [f] = await ctx.tx
          .select({ requested: fundingSubmissions.requestedAmount })
          .from(fundingSubmissions)
          .where(and(eq(fundingSubmissions.id, id), eq(fundingSubmissions.tenantId, ctx.identity.tenantId)));
        if (!f) throw new ValidationError("Funding submission not found");
        if (f.requested > cap) throw new ValidationError(`Requested ${f.requested} exceeds cap ${cap}`);
        await approveSubmissionOp(ctx, { id, approvedAmount: f.requested, notes });
        return { fundingSubmissionId: id, approvedAmount: f.requested };
      }
      const id = entityIdFrom(d.id, "mdf-");
      if (!id) throw new ValidationError("Decision has no MDF request");
      const [m] = await ctx.tx
        .select({ requested: mdfRequests.requestedAmount })
        .from(mdfRequests)
        .where(and(eq(mdfRequests.id, id), eq(mdfRequests.tenantId, ctx.identity.tenantId)));
      if (!m) throw new ValidationError("MDF request not found");
      if (m.requested > cap) throw new ValidationError(`Requested ${m.requested} exceeds cap ${cap}`);
      await approveRequestOp(ctx, { id, approvedAmount: m.requested, notes });
      return { mdfRequestId: id, approvedAmount: m.requested };
    }
    case "generate_report": {
      const r = await generateReportOp(ctx, {
        title: (typeof p.title === "string" && p.title) || `Automated report — ${opts.today}`,
        reportType: "executive_plan",
        periodStart: null,
        periodEnd: null,
        today: opts.today,
      });
      return { reportId: r.id };
    }
    case "notify": {
      await enqueueNotificationOp(ctx, {
        decision: d,
        playbookId: opts.playbookId,
        playbookName: opts.playbookName,
        channels: run.channels,
        runId: opts.runId,
      });
      return { notified: true };
    }
  }
}

/**
 * Evaluate the tenant's playbooks against the live decision queue and persist the
 * runs fire-once. `auto` runs dispatch immediately (failures are captured on the
 * run, never thrown up — a bad rule must not break the page). Mirrors the
 * materialize-on-read pattern of captureMetricSnapshot.
 */
export async function materializePlaybookRunsOp(
  ctx: MutationContext,
  args: { readonly decisions: readonly Decision[]; readonly mode: AutomationMode; readonly today: string },
): Promise<{ created: number; executed: number; failed: number; pending: number }> {
  const { identity, tx } = ctx;
  const rows = await tx
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.tenantId, identity.tenantId), eq(playbooks.enabled, true)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const likes: PlaybookLike[] = rows.map((r) => ({
    id: r.id,
    enabled: r.enabled,
    triggerSituation: r.triggerSituation,
    triggerMinSeverity: r.triggerMinSeverity,
    actionType: r.actionType,
    actionParams: r.actionParams,
    channels: r.channels,
  }));
  const planned = evaluatePlaybooks(likes, args.decisions, args.mode);

  let created = 0;
  let executed = 0;
  let failed = 0;
  let pending = 0;
  for (const run of planned) {
    const claimed = await tx
      .insert(playbookRuns)
      .values({
        tenantId: identity.tenantId,
        playbookId: run.playbookId,
        decisionId: run.decisionId,
        decision: run.decision as unknown as Record<string, unknown>,
        verdict: run.verdict,
        status: run.verdict === "approval" ? "pending_approval" : "recommended",
      })
      .onConflictDoNothing({
        target: [playbookRuns.tenantId, playbookRuns.playbookId, playbookRuns.decisionId],
      })
      .returning({ id: playbookRuns.id });
    if (claimed.length === 0) continue; // already fired for this decision
    created++;
    const runId = claimed[0]!.id;
    if (run.verdict === "approval") {
      pending++;
      continue;
    }
    if (run.verdict !== "auto") continue; // recommend — surfaced only
    const name = byId.get(run.playbookId)?.name ?? "playbook";
    try {
      const result = await dispatchAction(ctx, run, { today: args.today, playbookId: run.playbookId, playbookName: name, runId });
      await tx
        .update(playbookRuns)
        .set({ status: "executed", result, executedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(playbookRuns.id, runId));
      executed++;
    } catch (e) {
      await tx
        .update(playbookRuns)
        .set({ status: "failed", result: { error: (e as Error)?.message ?? String(e) }, updatedAt: sql`now()` })
        .where(eq(playbookRuns.id, runId));
      failed++;
    }
  }
  return { created, executed, failed, pending };
}

/** Approve a pending run and execute its action now. */
export async function approveRunOp(ctx: MutationContext, input: { readonly runId: string; readonly today: string }): Promise<{ status: string }> {
  const { identity, tx } = ctx;
  const [run] = await tx
    .select()
    .from(playbookRuns)
    .where(and(eq(playbookRuns.id, input.runId), eq(playbookRuns.tenantId, identity.tenantId)));
  if (!run) throw new ValidationError("Run not found");
  if (run.status !== "pending_approval") throw new ValidationError("Run is not awaiting approval");
  const [pb] = await tx.select().from(playbooks).where(eq(playbooks.id, run.playbookId));
  if (!pb) throw new ValidationError("Playbook no longer exists");
  const planned = {
    decision: run.decision as unknown as Decision,
    actionType: pb.actionType as PlaybookActionType,
    actionParams: pb.actionParams,
    channels: pb.channels.filter((c): c is NotifyChannel => c === "in_app" || c === "email" || c === "webhook"),
  };
  try {
    const result = await dispatchAction(ctx, planned, { today: input.today, playbookId: pb.id, playbookName: pb.name, runId: run.id });
    await tx
      .update(playbookRuns)
      .set({ status: "executed", result, approvedBy: identity.userId, approvedAt: sql`now()`, executedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(playbookRuns.id, run.id));
    return { status: "executed" };
  } catch (e) {
    await tx
      .update(playbookRuns)
      .set({ status: "failed", result: { error: (e as Error)?.message ?? String(e) }, approvedBy: identity.userId, approvedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(playbookRuns.id, run.id));
    throw e instanceof ValidationError ? e : new ValidationError("Action failed");
  }
}

export async function dismissRunOp({ identity, tx }: MutationContext, input: { readonly runId: string }): Promise<{ status: "dismissed" }> {
  await tx
    .update(playbookRuns)
    .set({ status: "dismissed", updatedAt: sql`now()` })
    .where(and(eq(playbookRuns.id, input.runId), eq(playbookRuns.tenantId, identity.tenantId)));
  return { status: "dismissed" };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export async function enqueueNotificationOp(
  { identity, tx }: MutationContext,
  input: {
    readonly decision: Decision;
    readonly playbookId: string;
    readonly playbookName: string;
    readonly channels: readonly NotifyChannel[];
    readonly runId: string | null;
  },
): Promise<{ id: string | null }> {
  const n = renderNotification(input.decision, { id: input.playbookId, name: input.playbookName });
  const [row] = await tx
    .insert(notifications)
    .values({
      tenantId: identity.tenantId,
      userId: input.decision.ownerUserId,
      source: "playbook",
      playbookRunId: input.runId,
      severity: n.severity,
      title: n.title,
      body: n.body,
      link: n.link,
      dedupeKey: n.dedupeKey,
      emailStatus: input.channels.includes("email") ? "pending" : "none",
      webhookStatus: input.channels.includes("webhook") ? "pending" : "none",
    })
    .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })
    .returning({ id: notifications.id });
  return { id: row?.id ?? null };
}

export async function markNotificationReadOp({ identity, tx }: MutationContext, input: { readonly id: string }): Promise<{ id: string }> {
  await tx
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.id, input.id), eq(notifications.tenantId, identity.tenantId)));
  return { id: input.id };
}

// ---------------------------------------------------------------------------
// Webhook targets
// ---------------------------------------------------------------------------
export async function createWebhookOp({ identity, tx }: MutationContext, input: { readonly url: string; readonly secret: string }): Promise<{ id: string }> {
  const [row] = await tx
    .insert(notificationWebhooks)
    .values({ tenantId: identity.tenantId, url: input.url, secret: input.secret })
    .returning({ id: notificationWebhooks.id });
  return { id: row!.id };
}

export async function setWebhookEnabledOp({ identity, tx }: MutationContext, input: { readonly id: string; readonly enabled: boolean }): Promise<{ id: string }> {
  await tx
    .update(notificationWebhooks)
    .set({ enabled: input.enabled })
    .where(and(eq(notificationWebhooks.id, input.id), eq(notificationWebhooks.tenantId, identity.tenantId)));
  return { id: input.id };
}

export async function deleteWebhookOp({ identity, tx }: MutationContext, input: { readonly id: string }): Promise<{ id: string }> {
  await tx.delete(notificationWebhooks).where(and(eq(notificationWebhooks.id, input.id), eq(notificationWebhooks.tenantId, identity.tenantId)));
  return { id: input.id };
}
