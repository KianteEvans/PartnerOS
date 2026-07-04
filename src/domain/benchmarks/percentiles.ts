/**
 * Cross-tenant benchmarking — pure math (Bet B, the NET-axis moat).
 *
 * ACE is single-account: AWS can never show a partner how it compares to peers.
 * This module holds the identity-free statistics that power "partners like you":
 * percentile summaries of a cohort, which cohort a tenant belongs to, and where a
 * tenant's own value falls. No database, no I/O — it takes plain numbers so it is
 * exhaustively unit-testable and reused verbatim by the aggregation job, the
 * loader, and the UI.
 *
 * Privacy invariant: a cohort is only ever surfaced when it has at least
 * `MIN_COHORT` participants (k-anonymity) — enforced by the aggregation code that
 * calls `summarize`, and asserted in tests.
 */

/** Never surface a cohort with fewer than this many participants (k-anonymity). */
export const MIN_COHORT = 5;

// ---------------------------------------------------------------------------
// Metric catalog — the 7 benchmarkable metrics. All are higher-is-better, so a
// single `positionOf` (no per-metric inversion) covers them. `format` tells the
// UI how to render the raw stored value; `nullable` metrics ("n/a") are dropped
// from cohorts until a tenant has enough data to compute them.
// ---------------------------------------------------------------------------
export type BenchmarkMetricKey =
  | "health"
  | "tier_percent"
  | "active_programs"
  | "marketplace_revenue"
  | "win_rate"
  | "evidence"
  | "mdf_roi";

export type MetricFormat = "score" | "percent" | "count" | "money" | "multiple";

export interface BenchmarkMetric {
  readonly key: BenchmarkMetricKey;
  readonly label: string;
  readonly format: MetricFormat;
  /** True when the metric can be "not enough data yet" (excluded from its cohort). */
  readonly nullable: boolean;
  readonly hint: string;
}

export const BENCHMARK_METRICS: readonly BenchmarkMetric[] = [
  { key: "health", label: "Partnership health", format: "score", nullable: false, hint: "Composite health across all partnership signals." },
  { key: "tier_percent", label: "Tier progress", format: "percent", nullable: true, hint: "Progress toward your target AWS partner tier." },
  { key: "active_programs", label: "Active programs", format: "count", nullable: false, hint: "AWS programs and competencies currently in flight." },
  { key: "marketplace_revenue", label: "Marketplace revenue", format: "money", nullable: false, hint: "Attributed AWS Marketplace revenue." },
  { key: "win_rate", label: "Co-sell win rate", format: "percent", nullable: true, hint: "Won vs. closed ACE opportunities." },
  { key: "evidence", label: "Evidence maturity", format: "percent", nullable: false, hint: "Share of approved evidence in your locker." },
  { key: "mdf_roi", label: "MDF ROI", format: "multiple", nullable: false, hint: "Influenced pipeline per approved MDF dollar." },
];

const METRIC_BY_KEY: Record<BenchmarkMetricKey, BenchmarkMetric> = Object.fromEntries(
  BENCHMARK_METRICS.map((m) => [m.key, m]),
) as Record<BenchmarkMetricKey, BenchmarkMetric>;

export function metricByKey(key: BenchmarkMetricKey): BenchmarkMetric {
  return METRIC_BY_KEY[key];
}

// ---------------------------------------------------------------------------
// Cohort dimensions.
// ---------------------------------------------------------------------------
export type CohortDimension = "tier" | "tenure";
export const DIMENSIONS: readonly CohortDimension[] = ["tier", "tenure"];

export type TenureBucket = "0_6mo" | "6_12mo" | "12_24mo" | "24mo_plus";

export const TENURE_BUCKETS: readonly TenureBucket[] = ["0_6mo", "6_12mo", "12_24mo", "24mo_plus"];

export const TENURE_LABELS: Record<TenureBucket, string> = {
  "0_6mo": "New (0-6 months)",
  "6_12mo": "6-12 months",
  "12_24mo": "1-2 years",
  "24mo_plus": "2+ years",
};

export const TIER_LABELS: Record<string, string> = {
  registered: "Registered",
  select: "Select",
  advanced: "Advanced",
  premier: "Premier",
};

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

/** Whole calendar months between two ISO dates (UTC), floored to the day of month. */
function calendarMonthsBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1; // not yet reached the anniversary day
  return months;
}

/** Which tenure cohort a tenant belongs to, from its createdAt vs today. */
export function tenureBucket(createdAtISO: string, today: string): TenureBucket {
  const months = calendarMonthsBetween(createdAtISO, today);
  if (months < 6) return "0_6mo";
  if (months < 12) return "6_12mo";
  if (months < 24) return "12_24mo";
  return "24mo_plus";
}

// ---------------------------------------------------------------------------
// Percentile math.
// ---------------------------------------------------------------------------

/**
 * The p-th percentile (0-100) of an ascending-sorted array, via linear
 * interpolation between the two closest ranks. Empty -> 0; single element -> it.
 */
export function percentile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0]!;
  const clamped = Math.max(0, Math.min(100, p));
  const rank = (clamped / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

export interface Summary {
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly count: number;
}

/**
 * Summarize a set of cohort values into integer percentiles + a participant
 * count. Nulls/undefined/non-finite values are dropped (a tenant that can't
 * compute the metric simply isn't counted). Percentiles are rounded because the
 * cohort store keeps them as bigints (metrics are scores/percents/cents/x100).
 */
export function summarize(values: readonly (number | null | undefined)[]): Summary {
  const nums = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);
  return {
    count: nums.length,
    p25: Math.round(percentile(nums, 25)),
    p50: Math.round(percentile(nums, 50)),
    p75: Math.round(percentile(nums, 75)),
    p90: Math.round(percentile(nums, 90)),
  };
}

// ---------------------------------------------------------------------------
// Position of a tenant's own value within its cohort.
// ---------------------------------------------------------------------------
export type Band = "top_quartile" | "above_median" | "below_median" | "bottom_quartile";

export const BAND_LABELS: Record<Band, string> = {
  top_quartile: "Top quartile",
  above_median: "Above median",
  below_median: "Below median",
  bottom_quartile: "Bottom quartile",
};

export interface Position {
  /** Approximate 0-100 percentile of `value` within the cohort. */
  readonly percentile: number;
  readonly band: Band;
}

/**
 * Approximate the percentile of `value` from the four known cohort anchors
 * (p25/p50/p75/p90), piecewise-linearly. Below p25 it interpolates from the
 * origin; above p90 it caps at 95 (we can't know the exact top without the max).
 * All benchmark metrics are higher-is-better.
 */
function estimatePercentile(value: number, s: Summary): number {
  if (value <= s.p25) {
    if (s.p25 <= 0) return value > 0 ? 25 : 0;
    return Math.round(Math.max(0, Math.min(25, (value / s.p25) * 25)));
  }
  const anchors: ReadonlyArray<readonly [number, number]> = [
    [25, s.p25],
    [50, s.p50],
    [75, s.p75],
    [90, s.p90],
  ];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [pa, va] = anchors[i]!;
    const [pb, vb] = anchors[i + 1]!;
    if (value <= vb) {
      if (vb === va) return pb;
      const frac = (value - va) / (vb - va);
      return Math.round(pa + (pb - pa) * frac);
    }
  }
  return 95; // above the 90th percentile anchor
}

/** Where `value` falls within a cohort `summary` (higher is better). */
export function positionOf(value: number, s: Summary): Position {
  let band: Band;
  if (value >= s.p75) band = "top_quartile";
  else if (value >= s.p50) band = "above_median";
  else if (value >= s.p25) band = "below_median";
  else band = "bottom_quartile";
  return { percentile: estimatePercentile(value, s), band };
}

// ---------------------------------------------------------------------------
// Display formatting for a raw stored metric value.
// ---------------------------------------------------------------------------

/** Format a raw stored value for display, per the metric's format. */
export function formatMetric(format: MetricFormat, value: number): string {
  switch (format) {
    case "score":
    case "count":
      return String(Math.round(value));
    case "percent":
      return `${Math.round(value)}%`;
    case "money":
      return `$${(value / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    case "multiple":
      return `${(value / 100).toFixed(1)}x`;
  }
}

/** Ordinal suffix for a percentile, e.g. 72 -> "72nd". */
export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1:
      return `${v}st`;
    case 2:
      return `${v}nd`;
    case 3:
      return `${v}rd`;
    default:
      return `${v}th`;
  }
}
