import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { DbIdentity } from "@/db/client";
import { tenants, workspaceSettings, metricSnapshots, benchmarkCohorts } from "@/db/schema";
import {
  BENCHMARK_METRICS,
  positionOf,
  tenureBucket,
  tierLabel,
  TENURE_LABELS,
  type BenchmarkMetricKey,
  type CohortDimension,
  type MetricFormat,
  type Position,
  type TenureBucket,
} from "./percentiles";

/**
 * Read-side of cross-tenant benchmarking (Bet B). Gated on reciprocal opt-in: a
 * non-participating workspace never sees peer numbers — only the opt-in CTA. For a
 * participant we read its own latest snapshot + the anonymized cohort percentiles
 * for its tier and tenure, and compute where it falls. All identity-free: the
 * cohort store carries no tenant data (that is what makes it safe to read).
 */

export interface MetricPosition {
  readonly key: BenchmarkMetricKey;
  readonly label: string;
  readonly format: MetricFormat;
  readonly hint: string;
  /** The tenant's own stored value (null = not enough data to compute). */
  readonly value: number | null;
  /** Cohort median (p50), or null when the cohort is missing/too small. */
  readonly cohortMedian: number | null;
  /** Cohort participant count for this metric (0 when absent). */
  readonly sampleCount: number;
  /** Where the value falls in the cohort — null when value or cohort is missing. */
  readonly position: Position | null;
}

export interface CohortView {
  readonly dimension: CohortDimension;
  readonly value: string;
  readonly label: string;
  readonly positions: readonly MetricPosition[];
  /** True when at least one metric has a surfaced (k-anonymized) cohort. */
  readonly hasData: boolean;
}

export type BenchmarkView =
  | { readonly participating: false }
  | {
      readonly participating: true;
      readonly tier: CohortView;
      readonly tenure: CohortView;
      readonly capturedOn: string | null;
    };

type SelfValues = Record<BenchmarkMetricKey, number | null>;

interface CohortRow {
  readonly metric: string;
  readonly capturedOn: string;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly sampleCount: number;
}

/** Latest cohort row per metric (rows arrive newest-first from SQL). */
function latestByMetric(rows: readonly CohortRow[]): Map<string, CohortRow> {
  const map = new Map<string, CohortRow>();
  for (const r of rows) if (!map.has(r.metric)) map.set(r.metric, r);
  return map;
}

function buildCohortView(
  dimension: CohortDimension,
  value: string,
  label: string,
  rows: readonly CohortRow[],
  self: SelfValues,
): { view: CohortView; latestCaptured: string | null } {
  const byMetric = latestByMetric(rows);
  let latestCaptured: string | null = null;
  let hasData = false;
  const positions: MetricPosition[] = BENCHMARK_METRICS.map((m) => {
    const row = byMetric.get(m.key) ?? null;
    const own = self[m.key];
    if (row && (latestCaptured === null || row.capturedOn > latestCaptured)) {
      latestCaptured = row.capturedOn;
    }
    if (row) hasData = true;
    const position =
      own != null && row
        ? positionOf(own, { p25: row.p25, p50: row.p50, p75: row.p75, p90: row.p90, count: row.sampleCount })
        : null;
    return {
      key: m.key,
      label: m.label,
      format: m.format,
      hint: m.hint,
      value: own,
      cohortMedian: row ? row.p50 : null,
      sampleCount: row ? row.sampleCount : 0,
      position,
    };
  });
  return { view: { dimension, value, label, positions, hasData }, latestCaptured };
}

export async function loadBenchmarks(identity: DbIdentity): Promise<BenchmarkView> {
  return withTenant(identity, async (tx): Promise<BenchmarkView> => {
    const settingsRows = await tx
      .select({ participating: workspaceSettings.benchmarkParticipation })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.tenantId, identity.tenantId))
      .limit(1);
    if (!settingsRows[0]?.participating) return { participating: false };

    const tenantRows = await tx
      .select({ tier: tenants.tier, createdAt: tenants.createdAt })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (!tenant) return { participating: false };

    const tier = tenant.tier;
    const tenure: TenureBucket = tenureBucket(
      new Date(tenant.createdAt).toISOString(),
      new Date().toISOString().slice(0, 10),
    );

    const snapRows = await tx
      .select({
        health: metricSnapshots.healthScore,
        tierPercent: metricSnapshots.tierPercent,
        activePrograms: metricSnapshots.activePrograms,
        marketplaceRevenue: metricSnapshots.marketplaceAttributedRevenueCents,
        winRate: metricSnapshots.winRatePercent,
        evidence: metricSnapshots.evidencePercent,
        mdfRoi: metricSnapshots.mdfRoiX100,
      })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.tenantId, identity.tenantId))
      .orderBy(desc(metricSnapshots.capturedOn))
      .limit(1);
    const s = snapRows[0];
    const self: SelfValues = {
      health: s?.health ?? null,
      tier_percent: s?.tierPercent ?? null,
      active_programs: s?.activePrograms ?? null,
      marketplace_revenue: s?.marketplaceRevenue ?? null,
      win_rate: s?.winRate ?? null,
      evidence: s?.evidence ?? null,
      mdf_roi: s?.mdfRoi ?? null,
    };

    const readCohort = (dimension: CohortDimension, cohortValue: string): Promise<CohortRow[]> =>
      tx
        .select({
          metric: benchmarkCohorts.metric,
          capturedOn: benchmarkCohorts.capturedOn,
          p25: benchmarkCohorts.p25,
          p50: benchmarkCohorts.p50,
          p75: benchmarkCohorts.p75,
          p90: benchmarkCohorts.p90,
          sampleCount: benchmarkCohorts.sampleCount,
        })
        .from(benchmarkCohorts)
        .where(
          and(
            eq(benchmarkCohorts.cohortDimension, dimension),
            eq(benchmarkCohorts.cohortValue, cohortValue),
          ),
        )
        .orderBy(desc(benchmarkCohorts.capturedOn));

    const [tierRows, tenureRows] = await Promise.all([
      readCohort("tier", tier),
      readCohort("tenure", tenure),
    ]);

    const tierBuilt = buildCohortView("tier", tier, tierLabel(tier), tierRows, self);
    const tenureBuilt = buildCohortView("tenure", tenure, TENURE_LABELS[tenure], tenureRows, self);

    const capturedOn =
      [tierBuilt.latestCaptured, tenureBuilt.latestCaptured]
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null;

    return {
      participating: true,
      tier: tierBuilt.view,
      tenure: tenureBuilt.view,
      capturedOn,
    };
  });
}

/**
 * Pull one metric's position for an inline band (Command health, Tiers progress).
 * Returns null when not participating, the cohort is missing/too small, or the
 * tenant has no value — callers simply render nothing in those cases.
 */
export function pickPosition(
  view: BenchmarkView,
  key: BenchmarkMetricKey,
  dimension: CohortDimension = "tier",
): MetricPosition | null {
  if (!view.participating) return null;
  const cohort = dimension === "tier" ? view.tier : view.tenure;
  const found = cohort.positions.find((p) => p.key === key);
  return found && found.position ? found : null;
}
