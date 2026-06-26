import { and, eq } from "drizzle-orm";
import { savedViews } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";
import { ValidationError } from "@/http/errors";
import { isKnownList } from "@/domain/views/saved";

/**
 * DB side of the saved-view mutations. Rows are user-owned: the user id is taken
 * from the verified identity (never the request), and RLS additionally scopes
 * reads/writes to (tenant, user) so a forged id can't touch another's presets.
 */

export interface SaveViewInput {
  readonly listKey: string;
  readonly name: string;
  readonly query: string;
}

export async function saveViewOp(
  { identity, tx }: MutationContext,
  input: SaveViewInput,
): Promise<{ id: string }> {
  if (!isKnownList(input.listKey)) throw new ValidationError("Unknown list");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Name is required");

  // Re-saving an existing name overwrites its query (one preset per name/list).
  const [row] = await tx
    .insert(savedViews)
    .values({
      tenantId: identity.tenantId,
      userId: identity.userId,
      listKey: input.listKey,
      name,
      query: input.query,
    })
    .onConflictDoUpdate({
      target: [savedViews.tenantId, savedViews.userId, savedViews.listKey, savedViews.name],
      set: { query: input.query },
    })
    .returning({ id: savedViews.id });
  return { id: row!.id };
}

export async function deleteViewOp(
  { identity, tx }: MutationContext,
  input: { readonly viewId: string },
): Promise<{ id: string }> {
  const deleted = await tx
    .delete(savedViews)
    .where(
      and(
        eq(savedViews.id, input.viewId),
        eq(savedViews.tenantId, identity.tenantId),
        eq(savedViews.userId, identity.userId),
      ),
    )
    .returning({ id: savedViews.id });
  if (deleted.length === 0) throw new ValidationError("View not found");
  return { id: input.viewId };
}
