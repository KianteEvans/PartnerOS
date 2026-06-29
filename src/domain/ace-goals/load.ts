import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { aceGoalSnapshots } from "@/db/schema";

/**
 * Materialize-on-read tracking for Co-Selling Goals: upsert today's measured value
 * per goal, then return each goal's recent chronological series for the trend
 * sparkline. Idempotent per (tenant, goal, day) via the unique index — the first
 * ACE load of the day inserts, later loads refresh today's point. One DB round-trip.
 * Mirrors the home-hub `captureMetricSnapshot` pattern (system-internal write, not
 * a user mutation, so it does not go through the gate).
 */
const HISTORY_DAYS = 30;

export async function syncGoalSnapshots(
  identity: DbIdentity,
  valuesByGoalId: ReadonlyMap<string, number>,
  today: string,
  days: number = HISTORY_DAYS,
): Promise<Map<string, number[]>> {
  const goalIds = [...valuesByGoalId.keys()];
  if (goalIds.length === 0) return new Map();

  return withTenant(identity, async (tx) => {
    for (const [goalId, value] of valuesByGoalId) {
      await tx
        .insert(aceGoalSnapshots)
        .values({ tenantId: identity.tenantId, goalId, capturedOn: today, currentValue: value })
        .onConflictDoUpdate({
          target: [aceGoalSnapshots.tenantId, aceGoalSnapshots.goalId, aceGoalSnapshots.capturedOn],
          set: { currentValue: value, updatedAt: sql`now()` },
        });
    }

    const rows = await tx
      .select({
        goalId: aceGoalSnapshots.goalId,
        currentValue: aceGoalSnapshots.currentValue,
      })
      .from(aceGoalSnapshots)
      .where(
        and(eq(aceGoalSnapshots.tenantId, identity.tenantId), inArray(aceGoalSnapshots.goalId, goalIds)),
      )
      .orderBy(asc(aceGoalSnapshots.capturedOn)); // chronological

    const byGoal = new Map<string, number[]>();
    for (const r of rows) {
      const arr = byGoal.get(r.goalId) ?? [];
      arr.push(r.currentValue);
      byGoal.set(r.goalId, arr);
    }
    // Keep only the trailing `days` points per goal for the sparkline.
    const out = new Map<string, number[]>();
    for (const [gid, series] of byGoal) {
      out.set(gid, series.slice(-days));
    }
    return out;
  });
}
