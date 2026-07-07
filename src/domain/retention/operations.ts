import { sql } from "drizzle-orm";
import type { TenantDb } from "@/db/client";
import { idempotencyKeys, metricSnapshots } from "@/db/schema";

/**
 * Data-retention pruning (production hygiene). Deletes rows that have outlived
 * their usefulness so unbounded tables don't grow forever:
 *   - idempotency_keys: the mutation gate only replays a completed response
 *     within a short window; COMPLETED keys older than 7 days are dead weight.
 *   - metric_snapshots: one row per tenant per day feeds the hub trend charts;
 *     keep ~2 years, prune older.
 *
 * The AUDIT LOG is deliberately NOT pruned here — it is an immutable governance
 * trail (append-only; UPDATE/DELETE are revoked from partneros_app). Any
 * archival of audit rows is a separate, deliberate operation.
 *
 * Runs under `withSystem` (owner) because a scheduled sweep spans every tenant
 * and has no per-request identity. It only DELETEs by age — never by tenant —
 * so there is nothing tenant-specific to scope.
 */

export const IDEMPOTENCY_RETENTION_DAYS = 7;
export const SNAPSHOT_RETENTION_DAYS = 730;

export interface RetentionResult {
  readonly idempotencyDeleted: number;
  readonly snapshotsDeleted: number;
}

/** A literal `interval 'N days'` from a trusted integer constant (no user input). */
function intervalDays(days: number): ReturnType<typeof sql.raw> {
  return sql.raw(`interval '${days} days'`);
}

export async function runRetentionOp(tx: TenantDb): Promise<RetentionResult> {
  const idemp = await tx
    .delete(idempotencyKeys)
    .where(
      sql`${idempotencyKeys.completedAt} is not null and ${idempotencyKeys.completedAt} < now() - ${intervalDays(IDEMPOTENCY_RETENTION_DAYS)}`,
    )
    .returning({ id: idempotencyKeys.id });
  const snaps = await tx
    .delete(metricSnapshots)
    .where(sql`${metricSnapshots.capturedOn} < now() - ${intervalDays(SNAPSHOT_RETENTION_DAYS)}`)
    .returning({ id: metricSnapshots.id });
  return { idempotencyDeleted: idemp.length, snapshotsDeleted: snaps.length };
}
