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
  readonly marketplaceRevenue: number[];
}

export interface MetricSnapshotValues {
  readonly openWork: number;
  readonly overdue: number;
  readonly activePrograms: number;
  readonly programsTotal: number;
  readonly tierPercent: number | null;
  readonly healthScore: number;
  /** Marketplace cross-section KPIs (optional — default 0 so existing callers stay valid). */
  readonly marketplacePublished?: number;
  readonly marketplaceActiveEntitlements?: number;
  readonly marketplaceRevenueCents?: number;
  /** Benchmarkable metrics (optional — win-rate/ROI null = "not enough data"; evidence defaults 0). */
  readonly winRatePercent?: number | null;
  readonly evidencePercent?: number;
  readonly mdfRoiX100?: number | null;
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
        marketplacePublished: m.marketplacePublished ?? 0,
        marketplaceActiveEntitlements: m.marketplaceActiveEntitlements ?? 0,
        marketplaceAttributedRevenueCents: m.marketplaceRevenueCents ?? 0,
        winRatePercent: m.winRatePercent ?? null,
        evidencePercent: m.evidencePercent ?? 0,
        mdfRoiX100: m.mdfRoiX100 ?? null,
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
          marketplacePublished: m.marketplacePublished ?? 0,
          marketplaceActiveEntitlements: m.marketplaceActiveEntitlements ?? 0,
          marketplaceAttributedRevenueCents: m.marketplaceRevenueCents ?? 0,
          winRatePercent: m.winRatePercent ?? null,
          evidencePercent: m.evidencePercent ?? 0,
          mdfRoiX100: m.mdfRoiX100 ?? null,
          updatedAt: sql`now()`,
        },
      }),
  );
}

/**
 * The recent daily series for the hub sparklines (chronological, last 14 days).
 * The daily capture is deferred past the response now, so the caller passes
 * today's freshly-computed values and we overlay them in memory — the series
 * still ends at "now" even before the write lands.
 */
export async function loadHubTrends(
  identity: DbIdentity,
  todayOverlay?: { readonly today: string; readonly values: MetricSnapshotValues },
): Promise<HubTrends> {
  return withTenant(identity, async (tx) => {
    const rows = await tx
      .select({
        capturedOn: metricSnapshots.capturedOn,
        openWork: metricSnapshots.openWork,
        overdue: metricSnapshots.overdue,
        activePrograms: metricSnapshots.activePrograms,
        tierPercent: metricSnapshots.tierPercent,
        marketplaceRevenue: metricSnapshots.marketplaceAttributedRevenueCents,
      })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.tenantId, identity.tenantId))
      .orderBy(desc(metricSnapshots.capturedOn))
      .limit(HISTORY);
    let s = rows.reverse(); // newest-first from SQL -> chronological for the sparkline
    if (todayOverlay) {
      const v = todayOverlay.values;
      const point = {
        capturedOn: todayOverlay.today,
        openWork: v.openWork,
        overdue: v.overdue,
        activePrograms: v.activePrograms,
        tierPercent: v.tierPercent,
        marketplaceRevenue: v.marketplaceRevenueCents ?? 0,
      };
      s =
        s[s.length - 1]?.capturedOn === todayOverlay.today
          ? [...s.slice(0, -1), point]
          : [...s, point].slice(-HISTORY);
    }
    return {
      openWork: s.map((r) => r.openWork),
      overdue: s.map((r) => r.overdue),
      activePrograms: s.map((r) => r.activePrograms),
      tierProgress: s.map((r) => r.tierPercent ?? 0),
      marketplaceRevenue: s.map((r) => r.marketplaceRevenue),
    };
  });
}
