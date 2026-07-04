import { sql } from "drizzle-orm";
import { workspaceSettings } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";

/**
 * Toggle the workspace's reciprocal benchmark participation. Upserts the settings
 * row so a tenant can opt in before it has ever saved other workspace settings
 * (all other columns carry defaults). Opting in both contributes this tenant's
 * anonymized metrics to future cohorts and unlocks the read side (see the loader).
 */
export async function setBenchmarkParticipationOp(
  { identity, tx }: MutationContext,
  input: { readonly participating: boolean },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(workspaceSettings)
    .values({
      tenantId: identity.tenantId,
      benchmarkParticipation: input.participating,
      createdBy: identity.userId,
    })
    .onConflictDoUpdate({
      target: workspaceSettings.tenantId,
      set: { benchmarkParticipation: input.participating, updatedAt: sql`now()` },
    })
    .returning({ id: workspaceSettings.id });
  return { id: row!.id };
}
