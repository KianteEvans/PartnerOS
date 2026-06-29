"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import {
  createOpportunitySchema,
  createRelationshipSchema,
  createInteractionSchema,
  opportunityIdSchema,
  relationshipIdSchema,
  stageEnum,
  statusEnum,
  roleEnum,
  isoDate,
  amount,
} from "@/domain/ace/schemas";
import {
  createOpportunityOp,
  updateOpportunityOp,
  approveRoutingOp,
  createRelationshipOp,
  updateRelationshipOp,
  logInteractionOp,
} from "@/domain/ace/operations";

/**
 * ACE server actions: validation, idempotency, and Next plumbing only. create/
 * update use a rotated per-form client token; approve-routing uses a
 * deterministic key. DB work lives in operations.ts.
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

export async function createOpportunity(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(createOpportunitySchema, {
      name: formData.get("name"),
      accountName: formData.get("accountName"),
      stage: formData.get("stage"),
      amount: formData.get("amount"),
      source: formData.get("source"),
      awsSeller: formData.get("awsSeller"),
      awsContactId: formData.get("awsContactId"),
      closeDate: formData.get("closeDate"),
    });
    await runMutation({
      permission: "ace:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "ace.create_opportunity",
      resourceType: "opportunity",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => createOpportunityOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  return { ok: true };
}

export async function updateOpportunity(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { opportunityId } = parseOrThrow(opportunityIdSchema, {
      opportunityId: formData.get("opportunityId"),
    });
    const input: {
      id: string;
      stage?: ReturnType<typeof stageEnum.parse>;
      status?: ReturnType<typeof statusEnum.parse>;
      amount?: number;
      ownerUserId?: string | null;
      nextStep?: string;
      lastInteraction?: string | null;
      closeDate?: string | null;
      awsContactId?: string | null;
      solutionId?: string | null;
      programId?: string | null;
    } = { id: opportunityId };
    if (formData.has("stage")) input.stage = parseOrThrow(stageEnum, formData.get("stage"));
    if (formData.has("status")) input.status = parseOrThrow(statusEnum, formData.get("status"));
    if (formData.has("amount")) input.amount = parseOrThrow(amount, formData.get("amount"));
    if (formData.has("ownerUserId")) {
      const o = String(formData.get("ownerUserId"));
      input.ownerUserId = o.length > 0 ? o : null;
    }
    if (formData.has("nextStep")) input.nextStep = String(formData.get("nextStep")).slice(0, 500);
    if (formData.has("lastInteraction")) {
      const d = String(formData.get("lastInteraction"));
      input.lastInteraction = d.length > 0 ? validDate(d) : null;
    }
    if (formData.has("closeDate")) {
      const d = String(formData.get("closeDate"));
      input.closeDate = d.length > 0 ? validDate(d) : null;
    }
    if (formData.has("awsContactId")) {
      const c = String(formData.get("awsContactId")).trim();
      if (c.length > 0 && !/^[0-9a-fA-F-]{36}$/.test(c)) throw new ValidationError("Invalid AWS contact");
      input.awsContactId = c.length > 0 ? c : null;
    }
    if (formData.has("solutionId")) {
      const s = String(formData.get("solutionId")).trim();
      if (s.length > 0 && !/^[0-9a-fA-F-]{36}$/.test(s)) throw new ValidationError("Invalid Solution");
      input.solutionId = s.length > 0 ? s : null;
    }
    if (formData.has("programId")) {
      const p = String(formData.get("programId")).trim();
      if (p.length > 0 && !/^[0-9a-fA-F-]{36}$/.test(p)) throw new ValidationError("Invalid Competency");
      input.programId = p.length > 0 ? p : null;
    }

    await runMutation({
      permission: "ace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "ace.update_opportunity",
      resourceType: "opportunity",
      resourceId: () => opportunityId,
      handler: (ctx) => updateOpportunityOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  return { ok: true };
}

export async function approveRouting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { opportunityId } = parseOrThrow(opportunityIdSchema, {
      opportunityId: formData.get("opportunityId"),
    });
    await runMutation({
      permission: "ace:approve",
      idempotencyKey: `approve-routing:${opportunityId}`,
      rawBody: JSON.stringify({ id: opportunityId }),
      action: "ace.approve_routing",
      resourceType: "opportunity",
      resourceId: () => opportunityId,
      auditMetadata: { event: "routing_approved" },
      handler: (ctx) => approveRoutingOp(ctx, { id: opportunityId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  revalidatePath("/command/tasks");
  return { ok: true };
}

export async function createRelationship(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(createRelationshipSchema, {
      name: formData.get("name"),
      role: formData.get("role"),
      accountName: formData.get("accountName"),
      strength: formData.get("strength"),
      lastContact: formData.get("lastContact"),
    });
    await runMutation({
      permission: "ace:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "ace.create_relationship",
      resourceType: "ace_relationship",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => createRelationshipOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  return { ok: true };
}

export async function updateRelationship(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { relationshipId } = parseOrThrow(relationshipIdSchema, {
      relationshipId: formData.get("relationshipId"),
    });
    const patch: {
      id: string;
      role?: ReturnType<typeof roleEnum.parse>;
      strength?: number;
      lastContact?: string | null;
      notes?: string;
    } = { id: relationshipId };
    if (formData.has("role")) patch.role = parseOrThrow(roleEnum, formData.get("role"));
    if (formData.has("strength")) {
      const n = Number(formData.get("strength"));
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new ValidationError("Strength must be 0–100");
      patch.strength = n;
    }
    if (formData.has("lastContact")) {
      const d = String(formData.get("lastContact"));
      patch.lastContact = d.length > 0 ? validDate(d) : null;
    }
    if (formData.has("notes")) patch.notes = String(formData.get("notes")).slice(0, 2000);

    await runMutation({
      permission: "ace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(patch),
      action: "ace.update_relationship",
      resourceType: "ace_relationship",
      resourceId: () => relationshipId,
      handler: (ctx) => updateRelationshipOp(ctx, patch),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  return { ok: true };
}

export async function logInteraction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = parseOrThrow(createInteractionSchema, {
      contactId: formData.get("contactId"),
      opportunityId: formData.get("opportunityId"),
      occurredOn: formData.get("occurredOn"),
      kind: formData.get("kind"),
      note: formData.get("note"),
    });
    await runMutation({
      permission: "ace:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "ace.log_interaction",
      resourceType: "ace_interaction",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) => logInteractionOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/ace");
  return { ok: true };
}
