"use server";

import { revalidatePath } from "next/cache";
import { runMutation } from "@/gate/mutation-gate";
import { AppError } from "@/http/errors";
import { parseOrThrow, type ActionState } from "@/domain/forms";
import { saveViewSchema, viewIdSchema } from "@/domain/views/schemas";
import { saveViewOp, deleteViewOp } from "@/domain/views/operations";
import { savedViewHref, isKnownList } from "@/domain/views/saved";

/**
 * Saved-view server actions. Personal presets, so the only gate is `view:manage`
 * (held by every role). Save uses the form's rotated idempotency token; delete
 * uses a deterministic key so a double-click dedupes. Each revalidates the list
 * route the view belongs to so its chips refresh.
 */

function failure(err: unknown): ActionState {
  if (err instanceof AppError) {
    return { ok: false, error: err.expose ? err.message : "Something went wrong" };
  }
  throw err;
}

function revalidateList(listKey: string): void {
  if (isKnownList(listKey)) revalidatePath(savedViewHref(listKey, ""));
}

export async function saveView(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let listKey = "";
  try {
    const input = parseOrThrow(saveViewSchema, {
      listKey: formData.get("listKey"),
      name: formData.get("name"),
      query: formData.get("query") ?? "",
    });
    listKey = input.listKey;
    await runMutation({
      permission: "view:manage",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      rawBody: JSON.stringify(input),
      action: "view.save",
      resourceType: "saved_view",
      resourceId: (r: { id: string }) => r.id,
      auditMetadata: { listKey: input.listKey, name: input.name },
      handler: (ctx) => saveViewOp(ctx, input),
    });
  } catch (err) {
    return failure(err);
  }
  revalidateList(listKey);
  return { ok: true };
}

export async function deleteSavedView(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { viewId } = parseOrThrow(viewIdSchema, { viewId: formData.get("viewId") });
    await runMutation({
      permission: "view:manage",
      idempotencyKey: `delete-view:${viewId}`,
      rawBody: JSON.stringify({ viewId }),
      action: "view.delete",
      resourceType: "saved_view",
      resourceId: () => viewId,
      handler: (ctx) => deleteViewOp(ctx, { viewId }),
    });
  } catch (err) {
    return failure(err);
  }
  revalidateList(String(formData.get("listKey") ?? ""));
  return { ok: true };
}
