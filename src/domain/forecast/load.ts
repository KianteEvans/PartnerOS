import { and, eq, gte, inArray } from "drizzle-orm";
import { withTenant, type DbIdentity } from "@/db/client";
import {
  marketplaceRevenueSnapshots,
  metricSnapshots,
  roadmaps,
  roadmapMilestones,
  roadmapSnapshots,
  mdfRequests,
} from "@/db/schema";
import { addDays } from "@/domain/dates";
import {
  monteCarloProjection,
  roadmapCompletionMC,
  linearProjection,
  seedFrom,
  type SeriesPoint,
  type Projection,
  type CompletionForecast,
} from "@/domain/forecast/project";
import { optimizeBudget, type BudgetPlan } from "@/domain/forecast/mdf-optimizer";
import { summaryByActivity, type ActivitySummary } from "@/domain/mdf/analytics";
import { budgetStatus, committedInPeriod, type BudgetStatus } from "@/domain/mdf/budget";
import { loadActiveBudget } from "@/domain/mdf/load";

/**
 * Read-only forecasting loader: pull each snapshot series' 90-day window plus the
 * optimizer inputs in one tenant-scoped (RLS) transaction and run the pure projection
 * engine. The Monte-Carlo seed is `${tenantId}:${today}` — projections are stable for
 * a tenant within a day (SSR-safe) and refresh daily as history accumulates.
 */

export const HISTORY_DAYS = 90;
export const REVENUE_HORIZON_DAYS = 90;
export const METRIC_HORIZON_DAYS = 60;

export interface SeriesForecast {
  readonly history: readonly SeriesPoint[];
  readonly projection: Projection | null;
  readonly current: number | null;
}

export interface RoadmapForecastRow {
  readonly id: string;
  readonly name: string;
  readonly done: number;
  readonly total: number;
  readonly plannedEnd: string | null;
  /** Simple average-slope ETA (comparison baseline). */
  readonly linearDate: string | null;
  /** Monte-Carlo completion; null under MIN_POINTS of history. */
  readonly mc: CompletionForecast | null;
  readonly snapshotCount: number;
}

export interface BudgetForecast {
  readonly periodLabel: string;
  readonly status: BudgetStatus;
  readonly activities: readonly ActivitySummary[];
  readonly plan: BudgetPlan | null;
}

export interface ForecastsView {
  readonly today: string;
  readonly revenue: SeriesForecast | null;
  readonly mrr: SeriesForecast | null;
  readonly health: SeriesForecast | null;
  readonly winRate: SeriesForecast | null;
  readonly roadmaps: readonly RoadmapForecastRow[];
  readonly budget: BudgetForecast | null;
}

function seriesForecast(
  history: readonly SeriesPoint[],
  opts: { horizonDays: number; seed: number; cap?: number },
): SeriesForecast | null {
  if (history.length === 0) return null;
  const projection = monteCarloProjection(history, {
    horizonDays: opts.horizonDays,
    seed: opts.seed,
    floor: 0,
    cap: opts.cap ?? null,
  });
  return { history, projection, current: history[history.length - 1]!.value ?? null };
}

/** Average-slope completion ETA over the done series (the "vs linear" comparison). */
function linearCompletionDate(
  points: readonly SeriesPoint[],
  total: number,
  today: string,
): string | null {
  const lin = linearProjection(points, { horizonDays: 1 });
  if (!lin || lin.slopePerDay <= 0) return null;
  const done = points[points.length - 1]!.value;
  const remaining = total - done;
  if (remaining <= 0) return today;
  return addDays(today, Math.ceil(remaining / lin.slopePerDay));
}

export async function loadForecasts(identity: DbIdentity): Promise<ForecastsView> {
  const today = new Date().toISOString().slice(0, 10);
  const seed = seedFrom(`${identity.tenantId}:${today}`);
  const since = addDays(today, -HISTORY_DAYS);

  // The active MDF budget opens its own tenant tx (sequential, the deal-desk idiom).
  const activeBudget = await loadActiveBudget(identity, today);

  return withTenant(identity, async (tx) => {
    const t = identity.tenantId;

    // Marketplace revenue + MRR series (cents -> dollars).
    const revRows = await tx
      .select({
        capturedOn: marketplaceRevenueSnapshots.capturedOn,
        revenueCents: marketplaceRevenueSnapshots.attributedRevenueCents,
        mrrCents: marketplaceRevenueSnapshots.mrrCents,
      })
      .from(marketplaceRevenueSnapshots)
      .where(and(eq(marketplaceRevenueSnapshots.tenantId, t), gte(marketplaceRevenueSnapshots.capturedOn, since)))
      .orderBy(marketplaceRevenueSnapshots.capturedOn);
    const revenueHistory = revRows.map((r) => ({ capturedOn: r.capturedOn, value: Number(r.revenueCents) / 100 }));
    const mrrHistory = revRows.map((r) => ({ capturedOn: r.capturedOn, value: Number(r.mrrCents) / 100 }));

    // Health + win-rate series.
    const metricRows = await tx
      .select({
        capturedOn: metricSnapshots.capturedOn,
        healthScore: metricSnapshots.healthScore,
        winRatePercent: metricSnapshots.winRatePercent,
      })
      .from(metricSnapshots)
      .where(and(eq(metricSnapshots.tenantId, t), gte(metricSnapshots.capturedOn, since)))
      .orderBy(metricSnapshots.capturedOn);
    const healthHistory = metricRows.map((r) => ({ capturedOn: r.capturedOn, value: r.healthScore }));
    const winRateHistory = metricRows
      .filter((r) => r.winRatePercent !== null)
      .map((r) => ({ capturedOn: r.capturedOn, value: r.winRatePercent! }));

    // Finalized roadmaps: live done/total from milestones, burn-up series from snapshots.
    const rmRows = await tx
      .select({ id: roadmaps.id, name: roadmaps.name })
      .from(roadmaps)
      .where(and(eq(roadmaps.tenantId, t), eq(roadmaps.status, "finalized")));
    const rmIds = rmRows.map((r) => r.id);
    const msRows = rmIds.length
      ? await tx
          .select({
            roadmapId: roadmapMilestones.roadmapId,
            status: roadmapMilestones.status,
            targetDate: roadmapMilestones.targetDate,
          })
          .from(roadmapMilestones)
          .where(and(eq(roadmapMilestones.tenantId, t), inArray(roadmapMilestones.roadmapId, rmIds)))
      : [];
    const snapRows = rmIds.length
      ? await tx
          .select({
            roadmapId: roadmapSnapshots.roadmapId,
            capturedOn: roadmapSnapshots.capturedOn,
            done: roadmapSnapshots.done,
          })
          .from(roadmapSnapshots)
          .where(
            and(
              eq(roadmapSnapshots.tenantId, t),
              inArray(roadmapSnapshots.roadmapId, rmIds),
              gte(roadmapSnapshots.capturedOn, since),
            ),
          )
          .orderBy(roadmapSnapshots.capturedOn)
      : [];

    const roadmapForecasts: RoadmapForecastRow[] = rmRows.map((rm) => {
      const ms = msRows.filter((m) => m.roadmapId === rm.id);
      const total = ms.length;
      const done = ms.filter((m) => m.status === "done").length;
      const plannedEnd = ms.reduce<string | null>((max, m) => (max === null || m.targetDate > max ? m.targetDate : max), null);
      const points: SeriesPoint[] = snapRows
        .filter((s) => s.roadmapId === rm.id)
        .map((s) => ({ capturedOn: s.capturedOn, value: s.done }));
      return {
        id: rm.id,
        name: rm.name,
        done,
        total,
        plannedEnd,
        linearDate: linearCompletionDate(points, total, today),
        mc: roadmapCompletionMC(points, total, today, { seed, plannedEnd }),
        snapshotCount: points.length,
      };
    });

    // MDF budget optimizer inputs.
    const mdfRows = await tx.select().from(mdfRequests).where(eq(mdfRequests.tenantId, t));
    let budget: BudgetForecast | null = null;
    if (activeBudget) {
      const committed = committedInPeriod(
        mdfRows.map((r) => ({
          status: r.status,
          approvedAmount: r.approvedAmount,
          startDate: r.startDate,
          createdAt: r.createdAt.toISOString().slice(0, 10),
        })),
        activeBudget.periodStart,
        activeBudget.periodEnd,
      );
      const status = budgetStatus(activeBudget.amount, committed);
      const activities = summaryByActivity(mdfRows);
      budget = {
        periodLabel: activeBudget.periodLabel,
        status,
        activities,
        plan: optimizeBudget(activities, status.remaining),
      };
    }

    return {
      today,
      revenue: seriesForecast(revenueHistory, { horizonDays: REVENUE_HORIZON_DAYS, seed }),
      mrr: seriesForecast(mrrHistory, { horizonDays: REVENUE_HORIZON_DAYS, seed: seed + 1 }),
      health: seriesForecast(healthHistory, { horizonDays: METRIC_HORIZON_DAYS, seed: seed + 2, cap: 100 }),
      winRate: seriesForecast(winRateHistory, { horizonDays: METRIC_HORIZON_DAYS, seed: seed + 3, cap: 100 }),
      roadmaps: roadmapForecasts,
      budget,
    };
  });
}
