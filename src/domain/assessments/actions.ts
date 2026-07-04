"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { getQuestion, type ModuleId } from "@/domain/assessments/catalog";
import {
  createAssessmentSchema,
  submitAssessmentSchema,
  reviewRecommendationSchema,
  parseOrThrow,
  type ActionState,
} from "@/domain/assessments/schemas";
import {
  createAssessmentOp,
  saveResponsesOp,
  submitAssessmentOp,
  reviewRecommendationOp,
  approveAllRecommendationsOp,
  bulkDeleteAssessmentsOp,
} from "@/domain/assessments/operations";
import { parseBulkIds } from "@/domain/bulk";

/**
 * Assessment server actions: validation, the idempotency-key strategy, and the
 * Next plumbing (revalidate/redirect) only. The database work lives in
 * operations.ts so it can run through the gate in tests too. Each action runs
 * through the single mutation gate (server-derived identity, authz, body-size,
 * rate limit, idempotency, RLS transaction, atomic audit row).
 *
 * Idempotency keys:
 *   - create / save  -> a per-form client token (rotated by MutationForm after
 *                       success): a true retry replays, a fresh edit is new work.
 *   - submit/approve  -> a DETERMINISTIC key from the resource id, so a cross-tab
 *     /reject           double-submit replays. The ops also status-guard.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err; // includes Next's redirect/notFound control-flow signals
}

/** Collect valid catalog answers from a save form's FormData. */
function collectResponses(
  formData: FormData,
): Array<{ module: ModuleId; questionKey: string; value: string }> {
  const out: Array<{ module: ModuleId; questionKey: string; value: string }> =
    [];
  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;
    const question = getQuestion(key);
    if (!question) continue; // skips assessmentId, idempotencyKey, Next internals
    if (!question.options.some((o) => o.value === raw)) continue; // unknown option
    out.push({ module: question.module, questionKey: key, value: raw });
  }
  return out;
}

export async function createAssessment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(createAssessmentSchema, {
      name: formData.get("name"),
      preset: formData.get("preset"),
      targetProgram: formData.get("targetProgram") ?? undefined,
    });
    const res = await runMutation({
      permission: "assessment:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "assessment.create",
      resourceType: "assessment",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { preset: input.preset },
      handler: (ctx) => createAssessmentOp(ctx, input),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/plan");
  redirect(`/plan/${newId}`);
}

export async function saveResponses(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { assessmentId } = parseOrThrow(submitAssessmentSchema, {
      assessmentId: formData.get("assessmentId"),
    });
    const answers = collectResponses(formData);
    await runMutation({
      permission: "assessment:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ assessmentId, answers }),
      action: "assessment.save_responses",
      resourceType: "assessment",
      resourceId: () => assessmentId,
      auditMetadata: { count: answers.length },
      handler: (ctx) => saveResponsesOp(ctx, { assessmentId, answers }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/${formData.get("assessmentId")}`);
  return { ok: true };
}

export async function submitAssessment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let assessmentId: string;
  try {
    ({ assessmentId } = parseOrThrow(submitAssessmentSchema, {
      assessmentId: formData.get("assessmentId"),
    }));
    await runMutation({
      permission: "assessment:submit",
      idempotencyKey: `submit:${assessmentId}`,
      rawBody: JSON.stringify({ assessmentId }),
      action: "assessment.submit",
      resourceType: "assessment",
      resourceId: () => assessmentId,
      handler: (ctx) => submitAssessmentOp(ctx, { assessmentId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/${assessmentId}`);
  return { ok: true };
}

async function reviewRecommendation(
  formData: FormData,
  decision: "approved" | "rejected",
): Promise<ActionState> {
  let assessmentId = "";
  try {
    const { recommendationId } = parseOrThrow(reviewRecommendationSchema, {
      recommendationId: formData.get("recommendationId"),
    });
    assessmentId = String(formData.get("assessmentId") ?? "");
    const keyVerb = decision === "approved" ? "approve" : "reject";
    await runMutation({
      permission: "assessment:approve",
      idempotencyKey: `${keyVerb}-rec:${recommendationId}`,
      rawBody: JSON.stringify({ recommendationId, decision }),
      action: `recommendation.${keyVerb}`,
      resourceType: "assessment_recommendation",
      resourceId: () => recommendationId,
      auditMetadata: { decision },
      handler: (ctx) =>
        reviewRecommendationOp(ctx, { recommendationId, decision }),
    });
  } catch (err) {
    return failure(err);
  }
  if (assessmentId) revalidatePath(`/plan/${assessmentId}`);
  return { ok: true };
}

export async function approveRecommendation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return reviewRecommendation(formData, "approved");
}

export async function rejectRecommendation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return reviewRecommendation(formData, "rejected");
}

/** Approve every still-pending recommendation on an assessment in one action. */
export async function approveAllRecommendations(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let assessmentId: string;
  try {
    ({ assessmentId } = parseOrThrow(submitAssessmentSchema, {
      assessmentId: formData.get("assessmentId"),
    }));
    await runMutation({
      permission: "assessment:approve",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ assessmentId }),
      action: "recommendation.approve_all",
      resourceType: "assessment",
      resourceId: () => assessmentId,
      handler: (ctx) => approveAllRecommendationsOp(ctx, { assessmentId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/plan/${assessmentId}`);
  return { ok: true };
}

export async function bulkDeleteAssessments(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ids = parseBulkIds(formData.get("ids"));
    await runMutation({
      permission: "assessment:delete",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ ids }),
      action: "assessment.bulk_delete",
      resourceType: "assessment",
      auditMetadata: { count: ids.length },
      handler: (ctx) => bulkDeleteAssessmentsOp(ctx, { ids }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/plan");
  return { ok: true };
}
