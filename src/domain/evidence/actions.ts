"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createEvidenceSchema,
  evidenceIdSchema,
  reviewEvidenceSchema,
  evidenceTypeEnum,
  openStatusEnum,
  isoDate,
  MAX_EVIDENCE_BYTES,
} from "@/domain/evidence/schemas";
import {
  createEvidenceOp,
  updateEvidenceOp,
  reviewEvidenceOp,
  uploadEvidenceFileOp,
  bulkUpdateEvidenceOp,
} from "@/domain/evidence/operations";
import { parseBulkIds } from "@/domain/bulk";

/**
 * Evidence Locker server actions: validation, idempotency, and Next plumbing.
 * create/update/upload use a rotated per-form client token; the DB + storage
 * work lives in operations.ts.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(createEvidenceSchema, {
      title: formData.get("title"),
      evidenceType: formData.get("evidenceType"),
      program: formData.get("program"),
      dueDate: formData.get("dueDate"),
      expirationDate: formData.get("expirationDate"),
    });
    await runMutation({
      permission: "evidence:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "evidence.create",
      resourceType: "evidence",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { type: input.evidenceType },
      handler: (ctx) =>
        createEvidenceOp(ctx, {
          ...input,
          ownerUserId: null,
          reusable: false,
        }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/evidence");
  return { ok: true };
}

export async function updateEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { evidenceId } = parseOrThrow(evidenceIdSchema, {
      evidenceId: formData.get("evidenceId"),
    });

    const input: {
      evidenceId: string;
      evidenceType?: ReturnType<typeof evidenceTypeEnum.parse>;
      program?: string | null;
      ownerUserId?: string | null;
      dueDate?: string | null;
      expirationDate?: string | null;
      reusable?: boolean;
      status?: ReturnType<typeof openStatusEnum.parse>;
    } = { evidenceId };

    if (formData.has("evidenceType")) {
      input.evidenceType = parseOrThrow(evidenceTypeEnum, formData.get("evidenceType"));
    }
    if (formData.has("status")) {
      input.status = parseOrThrow(openStatusEnum, formData.get("status"));
    }
    if (formData.has("program")) {
      const p = String(formData.get("program")).trim();
      input.program = p.length > 0 ? p.slice(0, 200) : null;
    }
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    if (formData.has("dueDate")) {
      const d = String(formData.get("dueDate"));
      input.dueDate = d.length > 0 ? validDate(d) : null;
    }
    if (formData.has("expirationDate")) {
      const d = String(formData.get("expirationDate"));
      input.expirationDate = d.length > 0 ? validDate(d) : null;
    }
    if (formData.has("reusable")) {
      input.reusable = formData.get("reusable") === "on" || formData.get("reusable") === "true";
    }

    await runMutation({
      permission: "evidence:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "evidence.update",
      resourceType: "evidence",
      resourceId: () => evidenceId,
      handler: (ctx) => updateEvidenceOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/evidence");
  return { ok: true };
}

export async function bulkUpdateEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ids = parseBulkIds(formData.get("ids"));
    const input: {
      ids: string[];
      ownerUserId?: string | null;
      status?: ReturnType<typeof openStatusEnum.parse>;
    } = { ids };
    if (formData.has("status")) {
      input.status = parseOrThrow(openStatusEnum, formData.get("status"));
    }
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    await runMutation({
      permission: "evidence:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "evidence.bulk_update",
      resourceType: "evidence",
      auditMetadata: {
        count: ids.length,
        fields: Object.keys(input).filter((k) => k !== "ids"),
      },
      handler: (ctx) => bulkUpdateEvidenceOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/evidence");
  return { ok: true };
}

export async function reviewEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(reviewEvidenceSchema, {
      evidenceId: formData.get("evidenceId"),
      decision: formData.get("decision"),
      qualityScore: formData.get("qualityScore"),
      notes: formData.get("notes"),
    });
    await runMutation({
      permission: "evidence:review",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: `evidence.${input.decision === "approved" ? "approve" : "reject"}`,
      resourceType: "evidence",
      resourceId: () => input.evidenceId,
      auditMetadata: { decision: input.decision, qualityScore: input.qualityScore },
      handler: (ctx) =>
        reviewEvidenceOp(ctx, {
          evidenceId: input.evidenceId,
          decision: input.decision,
          qualityScore: input.qualityScore,
          notes: input.notes,
        }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/evidence");
  return { ok: true };
}

export async function uploadEvidenceFile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { evidenceId } = parseOrThrow(evidenceIdSchema, {
      evidenceId: formData.get("evidenceId"),
    });
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError("Choose a file to upload");
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      throw new ValidationError("File exceeds the 10 MB limit");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName = file.name || "evidence";
    const contentType = file.type || "application/octet-stream";

    await runMutation({
      permission: "evidence:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      // The body hash covers the metadata; the bytes are enforced above.
      rawBody: JSON.stringify({ evidenceId, fileName, size: bytes.byteLength }),
      action: "evidence.upload_file",
      resourceType: "evidence",
      resourceId: () => evidenceId,
      auditMetadata: { fileName, size: bytes.byteLength },
      handler: (ctx) =>
        uploadEvidenceFileOp(ctx, { evidenceId, fileName, contentType, bytes }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/evidence");
  return { ok: true };
}

function validDate(d: string): string {
  if (!isoDate.safeParse(d).success) throw new ValidationError("Invalid date");
  return d;
}
