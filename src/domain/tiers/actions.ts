"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createPlanSchema,
  planIdSchema,
  requirementIdSchema,
  isoDate,
} from "@/domain/tiers/schemas";
import {
  createTierPlanOp,
  updatePlanOp,
  updateRequirementOp,
  createTaskFromTierRequirementOp,
  stageEvidenceForTierRequirementOp,
  advanceTierOp,
} from "@/domain/tiers/operations";

/**
 * Partner Tier server actions: validation, idempotency, and Next plumbing only.
 * create/update use a rotated per-form client token; the requirement handoffs
 * and advancement use deterministic keys. DB work lives in operations.ts.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function validDate(d: string): string {
  if (!isoDate.safeParse(d).success) throw new ValidationError("Invalid date");
  return d;
}

export async function createTierPlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(createPlanSchema, {
      targetTier: formData.get("targetTier"),
    });
    await runMutation({
      permission: "tier:create",
      idempotencyKey: "create-tier-plan",
      rawBody: JSON.stringify(input),
      action: "tier.create_plan",
      resourceType: "tier_plan",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { targetTier: input.targetTier },
      handler: (ctx) => createTierPlanOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/tiers");
  return { ok: true };
}

export async function updateTierRequirement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { requirementId } = parseOrThrow(requirementIdSchema, {
      requirementId: formData.get("requirementId"),
    });
    const input: {
      requirementId: string;
      currentValue?: number;
      ownerUserId?: string | null;
      targetDate?: string | null;
    } = { requirementId };
    if (formData.has("currentValue")) {
      const n = Number(formData.get("currentValue"));
      if (!Number.isInteger(n) || n < 0) {
        throw new ValidationError("Current value must be a non-negative whole number");
      }
      input.currentValue = n;
    }
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    if (formData.has("targetDate")) {
      const d = String(formData.get("targetDate"));
      input.targetDate = d.length > 0 ? validDate(d) : null;
    }

    await runMutation({
      permission: "tier:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "tier.update_requirement",
      resourceType: "tier_requirement",
      resourceId: () => requirementId,
      handler: (ctx) => updateRequirementOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/tiers");
  return { ok: true };
}

export async function updateTierPlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { planId } = parseOrThrow(planIdSchema, { planId: formData.get("planId") });
    const input: {
      planId: string;
      ownerUserId?: string | null;
      targetDate?: string | null;
      notes?: string;
    } = { planId };
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    if (formData.has("targetDate")) {
      const d = String(formData.get("targetDate"));
      input.targetDate = d.length > 0 ? validDate(d) : null;
    }
    if (formData.has("notes")) input.notes = String(formData.get("notes")).slice(0, 2000);

    await runMutation({
      permission: "tier:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "tier.update_plan",
      resourceType: "tier_plan",
      resourceId: () => planId,
      handler: (ctx) => updatePlanOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/tiers");
  return { ok: true };
}

export async function createTierRequirementTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { requirementId } = parseOrThrow(requirementIdSchema, {
      requirementId: formData.get("requirementId"),
    });
    await runMutation({
      permission: "tier:update",
      idempotencyKey: `tier-req-task:${requirementId}`,
      rawBody: JSON.stringify({ requirementId }),
      action: "tier.requirement_task",
      resourceType: "tier_requirement",
      resourceId: () => requirementId,
      handler: (ctx) => createTaskFromTierRequirementOp(ctx, { requirementId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/tiers");
  revalidatePath("/tasks");
  return { ok: true };
}

export async function stageTierRequirementEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { requirementId } = parseOrThrow(requirementIdSchema, {
      requirementId: formData.get("requirementId"),
    });
    await runMutation({
      permission: "tier:update",
      idempotencyKey: `tier-req-evidence:${requirementId}`,
      rawBody: JSON.stringify({ requirementId }),
      action: "tier.requirement_evidence",
      resourceType: "tier_requirement",
      resourceId: () => requirementId,
      handler: (ctx) => stageEvidenceForTierRequirementOp(ctx, { requirementId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/tiers");
  revalidatePath("/evidence");
  return { ok: true };
}

export async function advanceTier(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { planId } = parseOrThrow(planIdSchema, { planId: formData.get("planId") });
    await runMutation({
      permission: "tier:advance",
      idempotencyKey: `advance-tier:${planId}`,
      rawBody: JSON.stringify({ planId }),
      action: "tier.advance",
      resourceType: "tier_plan",
      resourceId: () => planId,
      auditMetadata: { event: "tier_advanced" },
      handler: (ctx) => advanceTierOp(ctx, { planId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/tiers");
  revalidatePath("/");
  return { ok: true };
}
