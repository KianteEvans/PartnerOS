import { desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { metricSnapshots } from "@/db/schema";

/**
 * Dense daily metric history for the workspace-home sparklines (Tier 3). Replaces the
 * sparse report-snapshot source with a dedicated `metric_snapshots` table that the
 * dashboard materializes once per day on load — a real cron writer would replace the
 * on-read capture, but this fills the series reliably as the workspace is used.
 */

export interface HubTrends {
  readonly openWork: number[];
  readonly overdue: number[];
  readonly activePrograms: number[];
  readonly tierProgress: number[];
}

export interface MetricSnapshotValues {
  readonly openWork: number;
  readonly overdue: number;
  readonly activePrograms: number;
  readonly programsTotal: number;
  readonly tierPercent: number | null;
  readonly healthScore: number;
}

const HISTORY = 14;

/**
 * Materialize-on-read: record today's metrics once per tenant per day. Idempotent via
 * the (tenant, captured_on) unique index — the first load of the day inserts, later
 * loads refresh today's row so the point tracks the latest state. Best-effort: the
 * caller swallows errors so a capture hiccup never blocks the dashboard render.
 */
export async function captureMetricSnapshot(
  identity: DbIdentity,
  m: MetricSnapshotValues,
  today: string,
): Promise<void> {
  await withTenant(identity, (tx) =>
    tx
      .insert(metricSnapshots)
      .values({
        tenantId: identity.tenantId,
        capturedOn: today,
        openWork: m.openWork,
        overdue: m.overdue,
        activePrograms: m.activePrograms,
        programsTotal: m.programsTotal,
        tierPercent: m.tierPercent,
        healthScore: m.healthScore,
      })
      .onConflictDoUpdate({
        target: [metricSnapshots.tenantId, metricSnapshots.capturedOn],
        set: {
          openWork: m.openWork,
          overdue: m.overdue,
          activePrograms: m.activePrograms,
          programsTotal: m.programsTotal,
          tierPercent: m.tierPercent,
          healthScore: m.healthScore,
          updatedAt: sql`now()`,
        },
      }),
  );
}

/** The recent daily series for the hub sparklines (chronological, last 14 days). The
 *  current day's row is captured on load, so the series already ends at "now". */
export async function loadHubTrends(identity: DbIdentity): Promise<HubTrends> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        openWork: metricSnapshots.openWork,
        overdue: metricSnapshots.overdue,
        activePrograms: metricSnapshots.activePrograms,
        tierPercent: metricSnapshots.tierPercent,
      })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.tenantId, identity.tenantId))
      .orderBy(desc(metricSnapshots.capturedOn))
      .limit(HISTORY);
    const s = rows.reverse(); // newest-first from SQL -> chronological for the sparkline
    return {
      openWork: s.map((r) => r.openWork),
      overdue: s.map((r) => r.overdue),
      activePrograms: s.map((r) => r.activePrograms),
      tierProgress: s.map((r) => r.tierPercent ?? 0),
    };
  });
}
