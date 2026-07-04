import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { roadmapSnapshots } from "@/db/schema";
import type { SnapshotPoint } from "@/domain/roadmaps/forecast";

/**
 * Per-roadmap daily burn-up history for the Trajectory forecast. Mirrors the
 * workspace-home metric_snapshots pattern: the detail page materializes today's
 * done-count once per roadmap per day on load, so the burn-up line gets a reliable
 * daily series WITHOUT a completed-at timestamp on each milestone. A real cron
 * writer would replace the on-read capture; this fills the series as roadmaps are
 * opened. Imports only a type from forecast.ts (no runtime cycle).
 */

const HISTORY = 14;

export interface RoadmapSnapshotValues {
  readonly done: number;
  readonly total: number;
  readonly overdue: number;
  readonly inProgress: number;
}

/**
 * Materialize-on-read: record this roadmap's done-count once per day. Idempotent
 * via the (tenant, roadmap, captured_on) unique index — the first load of the day
 * inserts, later loads refresh today's row. Best-effort: the caller swallows errors
 * so a capture hiccup never blocks the detail render.
 */
export async function captureRoadmapSnapshot(
  identity: DbIdentity,
  roadmapId: string,
  v: RoadmapSnapshotValues,
  today: string,
): Promise<void> {
  await withTenant(identity, (tx) =>
    tx
      .insert(roadmapSnapshots)
      .values({
        tenantId: identity.tenantId,
        roadmapId,
        capturedOn: today,
        done: v.done,
        total: v.total,
        overdue: v.overdue,
        inProgress: v.inProgress,
      })
      .onConflictDoUpdate({
        target: [roadmapSnapshots.tenantId, roadmapSnapshots.roadmapId, roadmapSnapshots.capturedOn],
        set: {
          done: v.done,
          total: v.total,
          overdue: v.overdue,
          inProgress: v.inProgress,
          updatedAt: sql`now()`,
        },
      }),
  );
}

/** The recent daily done-count series for this roadmap's burn-up (chronological, last 14 days). */
export async function loadRoadmapTrends(
  identity: DbIdentity,
  roadmapId: string,
): Promise<SnapshotPoint[]> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({ capturedOn: roadmapSnapshots.capturedOn, done: roadmapSnapshots.done })
      .from(roadmapSnapshots)
      .where(
        and(eq(roadmapSnapshots.tenantId, identity.tenantId), eq(roadmapSnapshots.roadmapId, roadmapId)),
      )
      .orderBy(desc(roadmapSnapshots.capturedOn))
      .limit(HISTORY);
    return rows.reverse(); // newest-first from SQL -> chronological for the burn-up
  });
}
