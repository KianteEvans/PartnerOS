"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { createAceGoalSchema, goalIdSchema } from "@/domain/ace-goals/schemas";
import { createAceGoalOp, updateAceGoalOp } from "@/domain/ace-goals/operations";

/**
 * Co-Selling Goal server actions: validation, idempotency, Next plumbing only.
 * DB work lives in operations.ts; tracking math is pure in catalog.ts/progress.ts.
 * Archive is an update of `status`.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createAceGoal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(createAceGoalSchema, {
      metricKey: formData.get("metricKey"),
      targetValue: formData.get("targetValue"),
      periodStart: formData.get("periodStart"),
      targetDeadline: formData.get("targetDeadline"),
    });
    await runMutation({
      permission: "ace_goal:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "ace_goal.create",
      resourceType: "ace_goal",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { metricKey: input.metricKey },
      handler: (ctx) => createAceGoalOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  return { ok: true };
}

export async function updateAceGoal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { goalId } = parseOrThrow(goalIdSchema, { goalId: formData.get("goalId") });
    const patch: {
      goalId: string;
      targetValue?: number;
      targetDeadline?: string | null;
      status?: "active" | "archived";
    } = { goalId };

    if (formData.has("targetValue")) {
      const n = Number(formData.get("targetValue"));
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000_000_000) {
        throw new ValidationError("Target must be at least 1");
      }
      patch.targetValue = n;
    }
    if (formData.has("targetDeadline")) {
      const d = String(formData.get("targetDeadline")).trim();
      if (d.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ValidationError("Invalid date");
      patch.targetDeadline = d.length > 0 ? d : null;
    }
    if (formData.has("status")) {
      const s = String(formData.get("status"));
      if (s !== "active" && s !== "archived") throw new ValidationError("Invalid status");
      patch.status = s;
    }

    await runMutation({
      permission: "ace_goal:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(patch),
      action: patch.status === "archived" ? "ace_goal.archive" : "ace_goal.update",
      resourceType: "ace_goal",
      resourceId: () => goalId,
      handler: (ctx) => updateAceGoalOp(ctx, patch),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  return { ok: true };
}
