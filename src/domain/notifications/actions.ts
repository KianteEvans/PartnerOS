"use server";

import { z } from "zod";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { addDays } from "@/domain/dates";
import { dismissDecisionOp } from "@/domain/notifications/operations";

const DismissSchema = z.object({
  decisionId: z.string().min(1, "Missing decision").max(200, "Invalid decision"),
});

/**
 * Snooze a decision for 7 days (tenant-wide). No revalidatePath: every consumer
 * of the decision queue is a dynamic render, and the bell hides the item
 * optimistically on the client.
 */
export async function dismissDecision(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { decisionId } = parseOrThrow(DismissSchema, {
      decisionId: String(formData.get("decisionId") ?? "").trim(),
    });
    const today = new Date().toISOString().slice(0, 10);
    const until = addDays(today, 7);
    await runMutation({
      permission: "notification:dismiss",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ decisionId, until }),
      action: "notification.dismiss",
      resourceType: "decision",
      resourceId: () => decisionId,
      handler: (ctx) => dismissDecisionOp(ctx, { decisionId, until }),
    });
    return { ok: true, detail: "Snoozed for 7 days." };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, error: err.expose ? err.message : "Something went wrong" };
    }
    throw err;
  }
}
