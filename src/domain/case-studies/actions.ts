"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import type { ActionState } from "@/domain/forms";
import {
  createCaseStudyOp,
  updateCaseStudyOp,
  attachCaseStudyOp,
  detachCaseStudyOp,
  type UpdateCaseStudyInput,
} from "@/domain/case-studies/operations";

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createCaseStudy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const title = String(formData.get("title") ?? "").trim();
    if (title.length < 2) throw new ValidationError("A title is required");
    const visibility = String(formData.get("visibility")) === "public" ? "public" : "private";
    const evidenceId = String(formData.get("evidenceId") ?? "").trim() || null;
    const res = await runMutation({
      permission: "case_study:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ title }),
      action: "case_study.create",
      resourceType: "case_study",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) =>
        createCaseStudyOp(ctx, {
          title: title.slice(0, 250),
          customerName: String(formData.get("customerName") ?? "").slice(0, 250),
          visibility,
          anonymized: formData.get("anonymized") === "on",
          evidenceId,
        }),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/programs/evidence/case-studies");
  redirect(`/programs/evidence/case-studies/${newId}`);
}

export async function updateCaseStudy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const caseStudyId = String(formData.get("caseStudyId") ?? "");
  try {
    if (!caseStudyId) throw new ValidationError("Missing case study");
    const patch: Record<string, string | boolean | null> = {};
    for (const f of [
      "title",
      "customerName",
      "url",
      "aboutCustomer",
      "challenge",
      "goals",
      "solution",
      "outcomes",
    ] as const) {
      if (formData.has(f)) patch[f] = String(formData.get(f)).slice(0, 4000);
    }
    if (formData.has("visibility")) {
      patch.visibility = String(formData.get("visibility")) === "public" ? "public" : "private";
    }
    if (formData.has("anonymized")) patch.anonymized = formData.get("anonymized") === "on";
    if (formData.has("evidenceId")) {
      patch.evidenceId = String(formData.get("evidenceId")).trim() || null;
    }
    await runMutation({
      permission: "case_study:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ caseStudyId }),
      action: "case_study.update",
      resourceType: "case_study",
      resourceId: () => caseStudyId,
      handler: (ctx) => updateCaseStudyOp(ctx, { caseStudyId, ...patch } as UpdateCaseStudyInput),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/programs/evidence/case-studies/${caseStudyId}`);
  revalidatePath("/programs/evidence/case-studies");
  return { ok: true };
}

export async function attachCaseStudy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  try {
    const caseStudyId = String(formData.get("caseStudyId") ?? "");
    if (!applicationId || !caseStudyId) throw new ValidationError("Missing application or case study");
    await runMutation({
      permission: "application:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ applicationId, caseStudyId }),
      action: "application.attach_case_study",
      resourceType: "application",
      resourceId: () => applicationId,
      handler: (ctx) => attachCaseStudyOp(ctx, { applicationId, caseStudyId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/programs/applications/${applicationId}`);
  return { ok: true };
}

export async function detachCaseStudy(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  try {
    const caseStudyId = String(formData.get("caseStudyId") ?? "");
    if (!applicationId || !caseStudyId) throw new ValidationError("Missing application or case study");
    await runMutation({
      permission: "application:update",
      idempotencyKey: `detach-cs:${applicationId}:${caseStudyId}`,
      rawBody: JSON.stringify({ applicationId, caseStudyId }),
      action: "application.detach_case_study",
      resourceType: "application",
      resourceId: () => applicationId,
      handler: (ctx) => detachCaseStudyOp(ctx, { applicationId, caseStudyId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/programs/applications/${applicationId}`);
  return { ok: true };
}
