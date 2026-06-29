"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  adoptProgramSchema,
  programIdSchema,
  requirementIdSchema,
  programStatusEnum,
  requirementStatusEnum,
  isoDate,
} from "@/domain/programs/schemas";
import {
  adoptProgramOp,
  autoLinkEvidenceForProgramOp,
  updateProgramOp,
  updateRequirementOp,
  createTaskFromRequirementOp,
  stageEvidenceForRequirementOp,
  submitProgramOp,
} from "@/domain/programs/operations";

/**
 * Program Management server actions: validation, idempotency, and Next plumbing.
 * adopt/update use a rotated per-form client token; submit and the requirement
 * handoffs use deterministic keys. DB work lives in operations.ts.
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

export async function adoptProgram(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(adoptProgramSchema, {
      libraryKey: formData.get("libraryKey"),
    });
    const res = await runMutation({
      permission: "program:create",
      idempotencyKey: `adopt-program:${input.libraryKey}`,
      rawBody: JSON.stringify(input),
      action: "program.adopt",
      resourceType: "program",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { libraryKey: input.libraryKey },
      handler: (ctx) => adoptProgramOp(ctx, input),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/programs");
  redirect(`/programs/${newId}`);
}

/**
 * Pursue a program from the Evidence Locker fit dashboard: adopt it AND auto-link
 * the partner's already-approved evidence to the seeded requirements, in one gated
 * transaction, so they land on the detail with instant progress instead of empty
 * placeholders. Reuses adoptProgramOp; idempotent via the deterministic key + the
 * op's own onConflict / null-only link filters.
 */
export async function pursueProgram(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const input = parseOrThrow(adoptProgramSchema, {
      libraryKey: formData.get("libraryKey"),
    });
    const today = new Date().toISOString().slice(0, 10);
    const res = await runMutation({
      permission: "program:create",
      idempotencyKey: `pursue-program:${input.libraryKey}`,
      rawBody: JSON.stringify(input),
      action: "program.pursue",
      resourceType: "program",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { libraryKey: input.libraryKey },
      handler: async (ctx) => {
        const adopted = await adoptProgramOp(ctx, input);
        const link = await autoLinkEvidenceForProgramOp(ctx, {
          programId: adopted.id,
          today,
        });
        return { id: adopted.id, linked: link.linked };
      },
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/programs");
  revalidatePath("/programs/evidence/fit");
  redirect(`/programs/${newId}`);
}

export async function updateProgram(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { programId } = parseOrThrow(programIdSchema, {
      programId: formData.get("programId"),
    });
    const input: {
      programId: string;
      status?: "pending" | "active" | "expired";
      ownerUserId?: string | null;
      expirationDate?: string | null;
      notes?: string;
      today?: string;
    } = { programId, today: new Date().toISOString().slice(0, 10) };
    if (formData.has("status")) {
      input.status = parseOrThrow(programStatusEnum, formData.get("status"));
    }
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    if (formData.has("expirationDate")) {
      const d = String(formData.get("expirationDate"));
      input.expirationDate = d.length > 0 ? validDate(d) : null;
    }
    if (formData.has("notes")) input.notes = String(formData.get("notes")).slice(0, 2000);

    await runMutation({
      permission: "program:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "program.update",
      resourceType: "program",
      resourceId: () => programId,
      handler: (ctx) => updateProgramOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/programs/${formData.get("programId")}`);
  return { ok: true };
}

export async function updateRequirement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const programId = String(formData.get("programId") ?? "");
  try {
    const { requirementId } = parseOrThrow(requirementIdSchema, {
      requirementId: formData.get("requirementId"),
    });
    const input: {
      requirementId: string;
      status?: "open" | "met" | "blocked";
      ownerUserId?: string | null;
      targetDate?: string | null;
    } = { requirementId };
    if (formData.has("status")) {
      input.status = parseOrThrow(requirementStatusEnum, formData.get("status"));
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
      permission: "program:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "program.update_requirement",
      resourceType: "program_requirement",
      resourceId: () => requirementId,
      handler: (ctx) => updateRequirementOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  if (programId) revalidatePath(`/programs/${programId}`);
  return { ok: true };
}

export async function createRequirementTask(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const programId = String(formData.get("programId") ?? "");
  try {
    const { requirementId } = parseOrThrow(requirementIdSchema, {
      requirementId: formData.get("requirementId"),
    });
    await runMutation({
      permission: "program:update",
      idempotencyKey: `req-task:${requirementId}`,
      rawBody: JSON.stringify({ requirementId }),
      action: "program.requirement_task",
      resourceType: "program_requirement",
      resourceId: () => requirementId,
      handler: (ctx) => createTaskFromRequirementOp(ctx, { requirementId }),
    });
  } catch (err) {
    return failure(err);
  }
  if (programId) revalidatePath(`/programs/${programId}`);
  revalidatePath("/command/tasks");
  return { ok: true };
}

export async function stageRequirementEvidence(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const programId = String(formData.get("programId") ?? "");
  try {
    const { requirementId } = parseOrThrow(requirementIdSchema, {
      requirementId: formData.get("requirementId"),
    });
    await runMutation({
      permission: "program:update",
      idempotencyKey: `req-evidence:${requirementId}`,
      rawBody: JSON.stringify({ requirementId }),
      action: "program.requirement_evidence",
      resourceType: "program_requirement",
      resourceId: () => requirementId,
      handler: (ctx) => stageEvidenceForRequirementOp(ctx, { requirementId }),
    });
  } catch (err) {
    return failure(err);
  }
  if (programId) revalidatePath(`/programs/${programId}`);
  revalidatePath("/programs/evidence");
  return { ok: true };
}

export async function submitProgram(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let programId: string;
  try {
    ({ programId } = parseOrThrow(programIdSchema, {
      programId: formData.get("programId"),
    }));
    const today = new Date().toISOString().slice(0, 10);
    await runMutation({
      permission: "program:submit",
      idempotencyKey: `submit-program:${programId}`,
      rawBody: JSON.stringify({ programId }),
      action: "program.submit",
      resourceType: "program",
      resourceId: () => programId,
      auditMetadata: { event: "submission_approved" },
      handler: (ctx) => submitProgramOp(ctx, { programId, today }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/programs/${programId}`);
  return { ok: true };
}
