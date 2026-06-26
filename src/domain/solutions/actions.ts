"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runMutation } from "@/gate/mutation-gate";
import { AppError, ValidationError } from "@/http/errors";
import type { ActionState } from "@/domain/forms";
import {
  createSolutionOp,
  updateSolutionOp,
  type UpdateSolutionInput,
  type SolutionType,
} from "@/domain/solutions/operations";

const SOLUTION_TYPES = [
  "software_product",
  "hardware_product",
  "consulting_service",
  "professional_service",
  "managed_service",
  "training_service",
  "other",
];
const AVAILABILITIES = ["available", "beta", "unsupported"];
const FTR_STATUSES = ["none", "requested", "approved"];

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

export async function createSolution(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const title = String(formData.get("title") ?? "").trim();
    if (title.length < 2) throw new ValidationError("A title is required");
    const typeRaw = String(formData.get("solutionType") ?? "");
    const solutionType = (SOLUTION_TYPES.includes(typeRaw) ? typeRaw : "consulting_service") as SolutionType;
    const res = await runMutation({
      permission: "solution:create",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ title }),
      action: "solution.create",
      resourceType: "solution",
      resourceId: (r: { id: string }) => r.id,
      handler: (ctx) =>
        createSolutionOp(ctx, {
          title: title.slice(0, 250),
          solutionType,
          programType: String(formData.get("programType") ?? "").slice(0, 60),
        }),
    });
    newId = res.body.id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/solutions");
  redirect(`/solutions/${newId}`);
}

export async function updateSolution(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const solutionId = String(formData.get("solutionId") ?? "");
  try {
    if (!solutionId) throw new ValidationError("Missing solution");
    const patch: Record<string, string | null> = {};
    for (const f of ["title", "programType", "description", "sellingProposition", "url", "marketplaceUrl"] as const) {
      if (formData.has(f)) patch[f] = String(formData.get(f)).slice(0, 4000);
    }
    if (formData.has("solutionType")) {
      const v = String(formData.get("solutionType"));
      if (SOLUTION_TYPES.includes(v)) patch.solutionType = v;
    }
    if (formData.has("availability")) {
      const v = String(formData.get("availability"));
      if (AVAILABILITIES.includes(v)) patch.availability = v;
    }
    if (formData.has("ftrStatus")) {
      const v = String(formData.get("ftrStatus"));
      if (FTR_STATUSES.includes(v)) patch.ftrStatus = v;
    }
    if (formData.has("renewalDate")) {
      patch.renewalDate = String(formData.get("renewalDate")).trim() || null;
    }
    await runMutation({
      permission: "solution:update",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify({ solutionId }),
      action: "solution.update",
      resourceType: "solution",
      resourceId: () => solutionId,
      handler: (ctx) => updateSolutionOp(ctx, { solutionId, ...patch } as UpdateSolutionInput),
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/solutions/${solutionId}`);
  revalidatePath("/solutions");
  return { ok: true };
}
