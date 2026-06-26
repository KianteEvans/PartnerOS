"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { generateReportSchema, reportIdSchema } from "@/domain/reports/schemas";
import {
  generateReportOp,
  regenerateReportOp,
  submitForReviewOp,
  approveReportOp,
  markExportedOp,
} from "@/domain/reports/operations";

/**
 * Reporting server actions: validation, idempotency, and Next plumbing only.
 * generate uses a rotated per-form token; lifecycle transitions use deterministic
 * keys. DB work lives in operations.ts.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function generateReport(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(generateReportSchema, {
      title: formData.get("title"),
      reportType: formData.get("reportType"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
    });
    const res = await runMutation({
      permission: "report:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "report.generate",
      resourceType: "report",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { reportType: input.reportType },
      handler: (ctx) => generateReportOp(ctx, { ...input, today: today() }),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/reports");
  redirect(`/reports/${newId}`);
}

export async function regenerateReport(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let reportId = "";
  try {
    ({ reportId } = parseOrThrow(reportIdSchema, { reportId: formData.get("reportId") }));
    await runMutation({
      permission: "report:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ reportId }),
      action: "report.regenerate",
      resourceType: "report",
      resourceId: () => reportId,
      handler: (ctx) => regenerateReportOp(ctx, { id: reportId, today: today() }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}

export async function submitReportForReview(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let reportId = "";
  try {
    ({ reportId } = parseOrThrow(reportIdSchema, { reportId: formData.get("reportId") }));
    await runMutation({
      permission: "report:update",
      idempotencyKey: `report-review:${reportId}`,
      rawBody: JSON.stringify({ reportId }),
      action: "report.submit_review",
      resourceType: "report",
      resourceId: () => reportId,
      handler: (ctx) => submitForReviewOp(ctx, { id: reportId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}

export async function approveReport(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let reportId = "";
  try {
    ({ reportId } = parseOrThrow(reportIdSchema, { reportId: formData.get("reportId") }));
    await runMutation({
      permission: "report:approve",
      idempotencyKey: `report-approve:${reportId}`,
      rawBody: JSON.stringify({ reportId }),
      action: "report.approve",
      resourceType: "report",
      resourceId: () => reportId,
      auditMetadata: { event: "report_approved" },
      handler: (ctx) => approveReportOp(ctx, { id: reportId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}

export async function markReportExported(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let reportId = "";
  try {
    ({ reportId } = parseOrThrow(reportIdSchema, { reportId: formData.get("reportId") }));
    await runMutation({
      permission: "report:update",
      idempotencyKey: `report-export:${reportId}`,
      rawBody: JSON.stringify({ reportId }),
      action: "report.mark_exported",
      resourceType: "report",
      resourceId: () => reportId,
      handler: (ctx) => markExportedOp(ctx, { id: reportId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}
