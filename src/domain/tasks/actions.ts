"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createTaskSchema,
  taskIdSchema,
  openStatus,
} from "@/domain/tasks/schemas";
import {
  createTaskOp,
  updateTaskOp,
  completeTaskOp,
  bulkUpdateTasksOp,
} from "@/domain/tasks/operations";
import { parseBulkIds } from "@/domain/bulk";

/**
 * Task server actions: validation, idempotency-key strategy, and Next plumbing
 * only; the DB work lives in operations.ts. Every action runs through the gate.
 * create/update use a rotated per-form client token; complete uses a
 * deterministic key (`complete-task:<id>`) plus a handler status-guard.
 */

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(createTaskSchema, {
      title: formData.get("title"),
      description: formData.get("description"),
      priority: formData.get("priority"),
      dueDate: formData.get("dueDate"),
    });
    await runMutation({
      permission: "task:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "task.create",
      resourceType: "task",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { priority: input.priority },
      handler: (ctx) =>
        createTaskOp(ctx, { ...input, ownerUserId: null }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/command/tasks");
  return { ok: true };
}

export async function updateTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { taskId } = parseOrThrow(taskIdSchema, {
      taskId: formData.get("taskId"),
    });

    const input: {
      taskId: string;
      status?: "open" | "in_progress" | "blocked";
      priority?: (typeof PRIORITIES)[number];
      ownerUserId?: string | null;
      dueDate?: string | null;
    } = { taskId };
    if (formData.has("status")) {
      const parsed = openStatus.safeParse(formData.get("status"));
      if (!parsed.success) throw new ValidationError("Invalid status");
      input.status = parsed.data;
    }
    if (formData.has("priority")) {
      const p = String(formData.get("priority"));
      if (!PRIORITIES.includes(p as (typeof PRIORITIES)[number])) {
        throw new ValidationError("Invalid priority");
      }
      input.priority = p as (typeof PRIORITIES)[number];
    }
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    if (formData.has("dueDate")) {
      const d = String(formData.get("dueDate"));
      input.dueDate = d.length > 0 ? d : null;
    }

    await runMutation({
      permission: "task:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "task.update",
      resourceType: "task",
      resourceId: () => taskId,
      handler: (ctx) => updateTaskOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/command/tasks");
  return { ok: true };
}

export async function completeTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { taskId } = parseOrThrow(taskIdSchema, {
      taskId: formData.get("taskId"),
    });
    await runMutation({
      permission: "task:complete",
      idempotencyKey: `complete-task:${taskId}`,
      rawBody: JSON.stringify({ taskId }),
      action: "task.complete",
      resourceType: "task",
      resourceId: () => taskId,
      handler: (ctx) => completeTaskOp(ctx, { taskId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/command/tasks");
  return { ok: true };
}

export async function bulkUpdateTasks(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ids = parseBulkIds(formData.get("ids"));
    const input: {
      ids: string[];
      status?: "open" | "in_progress" | "blocked";
      priority?: (typeof PRIORITIES)[number];
      ownerUserId?: string | null;
      complete?: boolean;
    } = { ids };
    if (formData.has("complete")) {
      input.complete = true;
    } else if (formData.has("status")) {
      const parsed = openStatus.safeParse(formData.get("status"));
      if (!parsed.success) throw new ValidationError("Invalid status");
      input.status = parsed.data;
    }
    if (formData.has("priority")) {
      const p = String(formData.get("priority"));
      if (!PRIORITIES.includes(p as (typeof PRIORITIES)[number])) {
        throw new ValidationError("Invalid priority");
      }
      input.priority = p as (typeof PRIORITIES)[number];
    }
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }

    await runMutation({
      permission: "task:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "task.bulk_update",
      resourceType: "task",
      auditMetadata: {
        count: ids.length,
        fields: Object.keys(input).filter((k) => k !== "ids"),
      },
      handler: (ctx) => bulkUpdateTasksOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/command/tasks");
  return { ok: true };
}
