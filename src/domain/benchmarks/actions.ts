"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { setBenchmarkParticipationSchema } from "./schemas";
import { setBenchmarkParticipationOp } from "./operations";

/**
 * Benchmarking server actions: validation, idempotency, and Next plumbing only.
 * Opt-in uses the existing settings:manage permission — it changes a workspace
 * setting (and, reciprocally, whether this tenant contributes to peer cohorts).
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function setBenchmarkParticipation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let participating = false;
  try {
    const input = parseOrThrow(setBenchmarkParticipationSchema, {
      participating: formData.get("participating"),
    });
    participating = input.participating;
    await runMutation({
      permission: "settings:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "benchmark.set_participation",
      resourceType: "workspace_settings",
      auditMetadata: { participating: input.participating },
      handler: (ctx) => setBenchmarkParticipationOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings");
  revalidatePath("/");
  return {
    ok: true,
    detail: participating
      ? "Benchmarking on -- you now see how you compare to peer cohorts."
      : "Benchmarking off -- peer comparisons are hidden.",
  };
}
