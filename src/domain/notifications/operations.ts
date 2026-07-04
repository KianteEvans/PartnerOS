import { sql } from "drizzle-orm";
import { decisionDismissals } from "@/db/schema";
import type { MutationContext } from "@/gate/mutation-gate";

/**
 * Snooze a derived decision. Decisions are recomputed from live state on every
 * read (deriveDecisions), so a dismissal is a tenant-wide presentation filter
 * keyed by the decision's deterministic id (e.g. `task-overdue-<uuid>`), not a
 * row delete. Upsert: re-snoozing an already-snoozed decision extends it.
 *
 * Known alias: `opp-<id>` is shared by the stalled_deal and aws_review
 * situations (same deal, one card) — snoozing one snoozes both by design.
 */
export interface DismissDecisionInput {
  readonly decisionId: string;
  /** ISO date (inclusive) the snooze holds through. */
  readonly until: string;
}

export async function dismissDecisionOp(
  ctx: MutationContext,
  input: DismissDecisionInput,
): Promise<{ id: string; until: string }> {
  const [row] = await ctx.tx
    .insert(decisionDismissals)
    .values({
      tenantId: ctx.identity.tenantId,
      decisionId: input.decisionId,
      dismissedUntil: input.until,
      dismissedBy: ctx.identity.userId,
    })
    .onConflictDoUpdate({
      target: [decisionDismissals.tenantId, decisionDismissals.decisionId],
      set: {
        dismissedUntil: input.until,
        dismissedBy: ctx.identity.userId,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: decisionDismissals.id });
  return { id: row!.id, until: input.until };
}
