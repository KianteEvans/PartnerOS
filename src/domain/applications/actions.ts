"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import type { ActionState } from "@/domain/forms";
import { parseWorkbook } from "@/domain/applications/workbook";
import {
  createApplicationFromUploadOp,
  updateControlOp,
  updateApplicationOp,
  markExportedOp,
  type UpdateControlInput,
  type UpdateApplicationInput,
} from "@/domain/applications/operations";
import { MAX_WORKBOOK_BYTES, isMet } from "@/domain/applications/schemas";
import { isAwsStatus } from "@/domain/applications/packet";

/**
 * Competency Application server actions: validation, idempotency, Next plumbing.
 * The upload PARSES the workbook in the action (never trusting the client) before
 * the gate stores it + snapshots the controls.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createApplication(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError("Choose a workbook (.xlsx) to upload");
    }
    if (file.size > MAX_WORKBOOK_BYTES) {
      throw new ValidationError("File exceeds the 12 MB limit");
    }
    if (!(file.name || "").toLowerCase().endsWith(".xlsx")) {
      throw new ValidationError("Upload an .xlsx workbook (.xlsm and other formats aren't supported)");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseWorkbook(bytes);
    if (parsed.controls.length === 0) {
      throw new ValidationError(
        "No controls found - is this an AWS Competency Self-Assessment workbook?",
      );
    }
    const programType = parsed.programType === "Unknown" ? "" : parsed.programType;
    const name = String(formData.get("name") ?? "").trim() || parsed.name || file.name.replace(/\.xlsx$/i, "");
    const competency = String(formData.get("competency") ?? "").trim() || parsed.name;

    const res = await runMutation({
      permission: "application:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ fileName: file.name, size: bytes.byteLength, controls: parsed.controls.length }),
      action: "application.create",
      resourceType: "application",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { fileName: file.name, controls: parsed.controls.length, programType },
      handler: (ctx) =>
        createApplicationFromUploadOp(ctx, { name, competency, programType, fileName: file.name, bytes, controls: parsed.controls }),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/applications");
  redirect(`/applications/${newId}`);
}

/** Review/accept one control: save the (possibly edited) response + Met?, mark accepted. */
export async function updateControl(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  try {
    const controlId = String(formData.get("controlId") ?? "");
    if (!controlId) throw new ValidationError("Missing control");
    const response = formData.has("response")
      ? String(formData.get("response")).slice(0, 8000)
      : undefined;
    const metRaw = formData.has("met") ? String(formData.get("met")) : "";
    const input: UpdateControlInput = {
      controlId,
      status: "accepted",
      ...(response !== undefined ? { response } : {}),
      ...(isMet(metRaw) ? { met: metRaw } : {}),
    };
    await runMutation({
      permission: "application:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "application.update_control",
      resourceType: "application_control",
      resourceId: () => controlId,
      handler: (ctx) => updateControlOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}

/** Update packet metadata (categories, POC) + the AWS application status. */
export async function updateApplication(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  try {
    if (!applicationId) throw new ValidationError("Missing application");
    const categories = formData.has("categories") ? String(formData.get("categories")).slice(0, 500) : undefined;
    const pocName = formData.has("pocName") ? String(formData.get("pocName")).slice(0, 200) : undefined;
    const pocEmail = formData.has("pocEmail") ? String(formData.get("pocEmail")).slice(0, 200) : undefined;
    const pocRole = formData.has("pocRole") ? String(formData.get("pocRole")).slice(0, 100) : undefined;
    const statusRaw = formData.has("awsStatus") ? String(formData.get("awsStatus")) : "";
    // Empty string => detach the Solution (null); absent => leave unchanged.
    const solutionId = formData.has("solutionId")
      ? String(formData.get("solutionId")).trim() || null
      : undefined;
    const input: UpdateApplicationInput = {
      applicationId,
      ...(categories !== undefined ? { categories } : {}),
      ...(pocName !== undefined ? { pocName } : {}),
      ...(pocEmail !== undefined ? { pocEmail } : {}),
      ...(pocRole !== undefined ? { pocRole } : {}),
      ...(isAwsStatus(statusRaw) ? { awsStatus: statusRaw } : {}),
      ...(solutionId !== undefined ? { solutionId } : {}),
    };
    await runMutation({
      permission: "application:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "application.update",
      resourceType: "application",
      resourceId: () => applicationId,
      handler: (ctx) => updateApplicationOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}

export async function markExported(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  try {
    if (!applicationId) throw new ValidationError("Missing application");
    await runMutation({
      permission: "application:update",
      idempotencyKey: `mark-exported:${applicationId}`,
      rawBody: JSON.stringify({ applicationId }),
      action: "application.mark_exported",
      resourceType: "application",
      resourceId: () => applicationId,
      handler: (ctx) => markExportedOp(ctx, { applicationId }),
    });
  } catch (err) {
    return failure(err);
  }
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}
