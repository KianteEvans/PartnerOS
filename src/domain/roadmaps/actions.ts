"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createRoadmapSchema,
  composedRoadmapSchema,
  roadmapIdSchema,
  milestoneIdSchema,
  setMilestoneStatusSchema,
  reorderMilestonesSchema,
  addMilestoneSchema,
  recomposeRoadmapSchema,
  replanRoadmapSchema,
  isoDate,
  optionalMilestoneRef,
} from "@/domain/roadmaps/schemas";
import {
  createRoadmapOp,
  createComposedRoadmapOp,
  updateMilestoneOp,
  setMilestoneStatusOp,
  reorderMilestonesOp,
  addMilestoneOp,
  removeMilestoneOp,
  recomposeRoadmapOp,
  duplicateRoadmapOp,
  reopenRoadmapOp,
  replanRoadmapOp,
  finalizeRoadmapOp,
  setRoadmapsArchivedOp,
} from "@/domain/roadmaps/operations";
import { parseBulkIds } from "@/domain/bulk";

/**
 * Roadmap server actions: validation, idempotency-key strategy, and Next
 * plumbing only; DB work lives in operations.ts. create/update use a rotated
 * per-form client token; finalize uses a deterministic key plus a status-guard.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createRoadmap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(createRoadmapSchema, {
      name: formData.get("name"),
      objective: formData.get("objective"),
      horizon: formData.get("horizon"),
      scenario: formData.get("scenario"),
      startDate: formData.get("startDate"),
      sourceAssessmentId: formData.get("sourceAssessmentId"),
    });
    const res = await runMutation({
      permission: "roadmap:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.create",
      resourceType: "roadmap",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { source: input.sourceAssessmentId ? "assessment" : "manual" },
      handler: (ctx) => createRoadmapOp(ctx, input),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/plan/roadmaps");
  redirect(`/plan/roadmaps/${newId}`);
}

export async function createComposedRoadmap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(composedRoadmapSchema, {
      name: formData.get("name"),
      objective: formData.get("objective"),
      horizon: formData.get("horizon"),
      scenario: formData.get("scenario"),
      startDate: formData.get("startDate"),
      programKeys: formData.get("programKeys"),
      targetTier: formData.get("targetTier"),
      owners: formData.get("owners"),
    });
    const res = await runMutation({
      permission: "roadmap:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.create",
      resourceType: "roadmap",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: {
        source: "composed",
        programs: String(input.programKeys.length),
        targetTier: input.targetTier ?? "none",
      },
      handler: (ctx) => createComposedRoadmapOp(ctx, input),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/plan/roadmaps");
  redirect(`/plan/roadmaps/${newId}`);
}

export async function updateMilestone(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let roadmapId = "";
  try {
    const { milestoneId } = parseOrThrow(milestoneIdSchema, {
      milestoneId: formData.get("milestoneId"),
    });
    roadmapId = String(formData.get("roadmapId") ?? "");

    const input: {
      milestoneId: string;
      ownerUserId?: string | null;
      targetDate?: string;
      title?: string;
      detail?: string;
      dependsOnId?: string | null;
    } = { milestoneId };
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    if (formData.has("targetDate")) {
      const d = String(formData.get("targetDate"));
      if (!isoDate.safeParse(d).success) throw new ValidationError("Invalid date");
      input.targetDate = d;
    }
    if (formData.has("title")) {
      const t = String(formData.get("title")).trim();
      if (t.length === 0) throw new ValidationError("Title is required");
      input.title = t.slice(0, 200);
    }
    if (formData.has("detail")) input.detail = String(formData.get("detail")).slice(0, 500);
    if (formData.has("dependsOnId")) {
      const parsed = optionalMilestoneRef.safeParse(formData.get("dependsOnId"));
      if (!parsed.success) throw new ValidationError("Invalid dependency");
      input.dependsOnId = parsed.data;
    }

    await runMutation({
      permission: "roadmap:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.update_milestone",
      resourceType: "roadmap_milestone",
      resourceId: () => milestoneId,
      handler: (ctx) => updateMilestoneOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  if (roadmapId) revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function setMilestoneStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const roadmapId = String(formData.get("roadmapId") ?? "");
  try {
    const input = parseOrThrow(setMilestoneStatusSchema, {
      milestoneId: formData.get("milestoneId"),
      status: formData.get("status"),
    });
    await runMutation({
      permission: "roadmap:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.set_milestone_status",
      resourceType: "roadmap_milestone",
      resourceId: () => input.milestoneId,
      handler: (ctx) => setMilestoneStatusOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  if (roadmapId) revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function reorderMilestones(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let roadmapId = "";
  try {
    const input = parseOrThrow(reorderMilestonesSchema, {
      roadmapId: formData.get("roadmapId"),
      orderedIds: formData.get("orderedIds"),
    });
    roadmapId = input.roadmapId;
    await runMutation({
      permission: "roadmap:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.reorder_milestones",
      resourceType: "roadmap",
      resourceId: () => input.roadmapId,
      handler: (ctx) => reorderMilestonesOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function addMilestone(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let roadmapId = "";
  try {
    const input = parseOrThrow(addMilestoneSchema, {
      roadmapId: formData.get("roadmapId"),
      title: formData.get("title"),
      detail: formData.get("detail"),
      targetDate: formData.get("targetDate"),
      ownerUserId: formData.get("ownerUserId"),
    });
    roadmapId = input.roadmapId;
    await runMutation({
      permission: "roadmap:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.add_milestone",
      resourceType: "roadmap",
      resourceId: () => input.roadmapId,
      handler: (ctx) => addMilestoneOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function removeMilestone(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const roadmapId = String(formData.get("roadmapId") ?? "");
  try {
    const { milestoneId } = parseOrThrow(milestoneIdSchema, {
      milestoneId: formData.get("milestoneId"),
    });
    await runMutation({
      permission: "roadmap:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ milestoneId }),
      action: "roadmap.remove_milestone",
      resourceType: "roadmap_milestone",
      resourceId: () => milestoneId,
      handler: (ctx) => removeMilestoneOp(ctx, { milestoneId }),
    });
  } catch (err) {
    return failure(err);
  }
  if (roadmapId) revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function recomposeRoadmap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let roadmapId = "";
  try {
    const input = parseOrThrow(recomposeRoadmapSchema, {
      roadmapId: formData.get("roadmapId"),
      programKeys: formData.getAll("programKeys").map(String),
      targetTier: formData.get("targetTier"),
    });
    roadmapId = input.roadmapId;
    await runMutation({
      permission: "roadmap:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.recompose",
      resourceType: "roadmap",
      resourceId: () => input.roadmapId,
      handler: (ctx) => recomposeRoadmapOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function duplicateRoadmap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const { roadmapId } = parseOrThrow(roadmapIdSchema, {
      roadmapId: formData.get("roadmapId"),
    });
    const res = await runMutation({
      permission: "roadmap:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ roadmapId }),
      action: "roadmap.duplicate",
      resourceType: "roadmap",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => duplicateRoadmapOp(ctx, { roadmapId }),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/plan/roadmaps");
  redirect(`/plan/roadmaps/${newId}`);
}

export async function reopenRoadmap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let roadmapId: string;
  try {
    ({ roadmapId } = parseOrThrow(roadmapIdSchema, {
      roadmapId: formData.get("roadmapId"),
    }));
    await runMutation({
      permission: "roadmap:finalize",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ roadmapId }),
      action: "roadmap.reopen",
      resourceType: "roadmap",
      resourceId: () => roadmapId,
      handler: (ctx) => reopenRoadmapOp(ctx, { roadmapId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function replanRoadmap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let roadmapId = "";
  try {
    const input = parseOrThrow(replanRoadmapSchema, {
      roadmapId: formData.get("roadmapId"),
      horizon: formData.get("horizon"),
      scenario: formData.get("scenario"),
      startDate: formData.get("startDate"),
    });
    roadmapId = input.roadmapId;
    await runMutation({
      permission: "roadmap:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "roadmap.replan",
      resourceType: "roadmap",
      resourceId: () => input.roadmapId,
      handler: (ctx) => replanRoadmapOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/roadmaps/${roadmapId}`);
  return { ok: true };
}

export async function finalizeRoadmap(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let roadmapId: string;
  try {
    ({ roadmapId } = parseOrThrow(roadmapIdSchema, {
      roadmapId: formData.get("roadmapId"),
    }));
    await runMutation({
      permission: "roadmap:finalize",
      // Rotating token (not a deterministic key) so a re-finalize after re-open
      // actually runs; the op's status-guard + sourceRef task dedup keep it
      // idempotent against accidental double-submits.
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ roadmapId }),
      action: "roadmap.finalize",
      resourceType: "roadmap",
      resourceId: () => roadmapId,
      handler: (ctx) => finalizeRoadmapOp(ctx, { roadmapId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/roadmaps/${roadmapId}`);
  revalidatePath("/command/tasks");
  // Finalizing a composed roadmap may adopt programs + open a tier plan.
  revalidatePath("/programs");
  revalidatePath("/programs/tiers");
  return { ok: true };
}

export async function bulkSetRoadmapsArchived(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ids = parseBulkIds(formData.get("ids"));
    const archived = formData.get("archived") === "1";
    await runMutation({
      permission: "roadmap:archive",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ ids, archived }),
      action: archived ? "roadmap.bulk_archive" : "roadmap.bulk_restore",
      resourceType: "roadmap",
      auditMetadata: { count: ids.length },
      handler: (ctx) => setRoadmapsArchivedOp(ctx, { ids, archived }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/plan/roadmaps");
  return { ok: true };
}
