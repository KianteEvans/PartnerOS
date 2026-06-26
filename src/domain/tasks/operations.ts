import { and, eq, inArray, sql } from "drizzle-orm";
import { tasks, users, roadmapMilestones } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import {
  taskStatusToMilestone,
  type TaskStatusValue,
} from "@/domain/roadmaps/status-sync";

/**
 * The database side of each task mutation, factored out of the server actions
 * so it can run through the gate in both the actions and the integration tests.
 * Every function takes the gate's MutationContext (verified identity + the
 * RLS-scoped transaction).
 */

type Priority = "low" | "medium" | "high" | "critical";
type OpenStatus = "open" | "in_progress" | "blocked";

/**
 * Close the loop: a finalize-spawned roadmap milestone (linked by `taskId`)
 * mirrors its task's status. A direct table write — no roadmap op is invoked, so
 * there is no feedback cycle — and a no-op for non-roadmap tasks (nothing links
 * to them). `inArray` handles both the single- and bulk-update paths.
 */
async function syncMilestonesFromTasks(
  { identity, tx }: MutationContext,
  taskIds: readonly string[],
  status: TaskStatusValue,
): Promise<void> {
  if (taskIds.length === 0) return;
  await tx
    .update(roadmapMilestones)
    .set({ status: taskStatusToMilestone(status), updatedAt: sql`now()` })
    .where(
      and(
        inArray(roadmapMilestones.taskId, [...taskIds]),
        eq(roadmapMilestones.tenantId, identity.tenantId),
      ),
    );
}

export interface CreateTaskInput {
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
}

export async function createTaskOp(
  { identity, tx }: MutationContext,
  input: CreateTaskInput,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(tasks)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      ownerUserId: input.ownerUserId,
      dueDate: input.dueDate,
      source: "manual",
      createdBy: identity.userId,
    })
    .returning({ id: tasks.id });
  return { id: row!.id };
}

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly status?: OpenStatus;
  readonly priority?: Priority;
  /** undefined = leave; null = unassign; string = assign. */
  readonly ownerUserId?: string | null;
  /** undefined = leave; null = clear; string = set. */
  readonly dueDate?: string | null;
}

export async function updateTaskOp(
  { identity, tx }: MutationContext,
  input: UpdateTaskInput,
): Promise<{ id: string }> {
  // A new owner must be a user in THIS tenant. RLS scopes the lookup, so a
  // forged cross-tenant user id simply isn't found.
  if (input.ownerUserId) {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.ownerUserId),
          eq(users.tenantId, identity.tenantId),
        ),
      );
    if (!owner) throw new ValidationError("Owner is not a member of this workspace");
  }

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.status !== undefined) {
    set.status = input.status;
    set.completedAt = null; // moving back to an open state clears completion
  }
  if (input.priority !== undefined) set.priority = input.priority;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;

  const updated = await tx
    .update(tasks)
    .set(set)
    .where(
      and(eq(tasks.id, input.taskId), eq(tasks.tenantId, identity.tenantId)),
    )
    .returning({ id: tasks.id });
  if (updated.length === 0) throw new ValidationError("Task not found");
  if (input.status !== undefined) {
    await syncMilestonesFromTasks({ identity, tx }, [input.taskId], input.status);
  }
  return { id: input.taskId };
}

export interface BulkUpdateTasksInput {
  readonly ids: readonly string[];
  readonly status?: OpenStatus;
  readonly priority?: Priority;
  /** undefined = leave; null = unassign; string = assign. */
  readonly ownerUserId?: string | null;
  /** When true, marks every selected task done (overrides status). */
  readonly complete?: boolean;
}

/**
 * Apply one change to many tasks in a single RLS-scoped UPDATE. The whole batch
 * is one transaction (and one audit row, written by the gate), so it's atomic —
 * a forged cross-tenant id simply isn't matched by the tenant predicate.
 */
export async function bulkUpdateTasksOp(
  { identity, tx }: MutationContext,
  input: BulkUpdateTasksInput,
): Promise<{ count: number }> {
  if (input.ids.length === 0) throw new ValidationError("No rows selected");

  if (input.ownerUserId) {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.ownerUserId), eq(users.tenantId, identity.tenantId)));
    if (!owner) throw new ValidationError("Owner is not a member of this workspace");
  }

  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.complete) {
    set.status = "done";
    set.completedAt = sql`now()`;
  } else if (input.status !== undefined) {
    set.status = input.status;
    set.completedAt = null;
  }
  if (input.priority !== undefined) set.priority = input.priority;
  if (input.ownerUserId !== undefined) set.ownerUserId = input.ownerUserId;

  const updated = await tx
    .update(tasks)
    .set(set)
    .where(and(inArray(tasks.id, [...input.ids]), eq(tasks.tenantId, identity.tenantId)))
    .returning({ id: tasks.id });
  const syncedStatus: TaskStatusValue | null = input.complete
    ? "done"
    : input.status ?? null;
  if (syncedStatus) {
    await syncMilestonesFromTasks(
      { identity, tx },
      updated.map((u) => u.id),
      syncedStatus,
    );
  }
  return { count: updated.length };
}

export async function completeTaskOp(
  { identity, tx }: MutationContext,
  input: { readonly taskId: string },
): Promise<{ id: string }> {
  const done = await tx
    .update(tasks)
    .set({ status: "done", completedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(tasks.id, input.taskId),
        eq(tasks.tenantId, identity.tenantId),
        sql`${tasks.status} <> 'done'`,
      ),
    )
    .returning({ id: tasks.id });
  if (done.length === 0) {
    throw new ValidationError("Task not found or already completed");
  }
  await syncMilestonesFromTasks({ identity, tx }, [input.taskId], "done");
  return { id: input.taskId };
}

type TaskSource =
  | "manual"
  | "assessment"
  | "mdf"
  | "program"
  | "evidence"
  | "tier"
  | "roadmap"
  | "ace"
  | "onboarding";

export interface SourcedTaskInput {
  readonly title: string;
  readonly description: string;
  readonly priority: Priority;
  readonly source: TaskSource;
  /** Stable id of the originating object; powers idempotent handoffs. */
  readonly sourceRef: string;
  /** Optional initial owner (the caller is responsible for tenant validity). */
  readonly ownerUserId?: string | null;
}

/**
 * Spawn a source-linked task from another section. The partial unique index
 * (tenant, source, source_ref) makes this idempotent, so a replay can never
 * create a duplicate. Returns the new task id, or null if one already existed.
 */
export async function createSourcedTask(
  { identity, tx }: MutationContext,
  input: SourcedTaskInput,
): Promise<{ taskId: string | null }> {
  const [row] = await tx
    .insert(tasks)
    .values({
      tenantId: identity.tenantId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      source: input.source,
      sourceRef: input.sourceRef,
      ownerUserId: input.ownerUserId ?? null,
      createdBy: identity.userId,
    })
    .onConflictDoNothing({
      target: [tasks.tenantId, tasks.source, tasks.sourceRef],
      where: sql`source_ref IS NOT NULL`,
    })
    .returning({ id: tasks.id });
  return { taskId: row?.id ?? null };
}

/** Priority for a task spawned from an assessment recommendation. */
function recommendationPriority(type: string, confidence: number): Priority {
  if (type === "evidence_gap") return "high";
  if (confidence >= 80) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

export interface RecommendationForTask {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly confidence: number;
}

/** Spawn a source-linked task from an approved assessment recommendation. */
export async function createTaskFromRecommendation(
  ctx: MutationContext,
  rec: RecommendationForTask,
): Promise<{ taskId: string | null }> {
  return createSourcedTask(ctx, {
    title: rec.title,
    description: rec.detail,
    priority: recommendationPriority(rec.type, rec.confidence),
    source: "assessment",
    sourceRef: rec.id,
  });
}
