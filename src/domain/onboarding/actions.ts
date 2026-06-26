"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  contextSchema,
  pathSchema,
  backStepSchema,
} from "@/domain/onboarding/schemas";
import {
  startOnboardingOp,
  saveContextOp,
  saveObjectivesOp,
  choosePathOp,
  setStepOp,
  completeOnboardingOp,
} from "@/domain/onboarding/operations";

/**
 * Onboarding server actions: validation, idempotency-key strategy, and Next
 * plumbing only. All run through the gate under onboarding:manage. Step actions
 * use a rotated per-form client token; start/complete use deterministic keys
 * (idempotency_keys is tenant-scoped, so a constant key is per-tenant unique).
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function startOnboarding(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    await runMutation({
      permission: "onboarding:manage",
      idempotencyKey: "onboarding-start",
      rawBody: "{}",
      action: "onboarding.start",
      resourceType: "onboarding",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => startOnboardingOp(ctx),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/onboarding");
  return { ok: true };
}

export async function saveContext(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(contextSchema, {
      companyName: formData.get("companyName"),
      industry: formData.get("industry"),
      partnerType: formData.get("partnerType"),
      awsStage: formData.get("awsStage"),
      teamSize: formData.get("teamSize"),
    });
    await runMutation({
      permission: "onboarding:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "onboarding.save_context",
      resourceType: "onboarding",
      handler: (ctx) => saveContextOp(ctx, input).then(() => ({ ok: true })),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/onboarding");
  return { ok: true };
}

export async function saveObjectives(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const objectives = formData.getAll("objectives").map(String);
    await runMutation({
      permission: "onboarding:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ objectives }),
      action: "onboarding.save_objectives",
      resourceType: "onboarding",
      handler: (ctx) =>
        saveObjectivesOp(ctx, { objectives }).then(() => ({ ok: true })),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/onboarding");
  return { ok: true };
}

export async function choosePath(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(pathSchema, { path: formData.get("path") });
    await runMutation({
      permission: "onboarding:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "onboarding.choose_path",
      resourceType: "onboarding",
      handler: (ctx) => choosePathOp(ctx, input).then(() => ({ ok: true })),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/onboarding");
  return { ok: true };
}

export async function backToStep(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(backStepSchema, { step: formData.get("step") });
    await runMutation({
      permission: "onboarding:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "onboarding.set_step",
      resourceType: "onboarding",
      handler: (ctx) => setStepOp(ctx, input).then(() => ({ ok: true })),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/onboarding");
  return { ok: true };
}

export async function completeOnboarding(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    await runMutation({
      permission: "onboarding:manage",
      idempotencyKey: "onboarding-complete",
      rawBody: "{}",
      action: "onboarding.complete",
      resourceType: "onboarding",
      auditMetadata: { event: "platform_unlock" },
      handler: (ctx) => completeOnboardingOp(ctx),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/onboarding");
  revalidatePath("/");
  return { ok: true };
}
