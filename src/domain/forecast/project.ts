import { addDays, daysBetween } from "@/domain/dates";

/**
 * Pure Monte-Carlo projection engine over the app's daily snapshot series. Snapshots
 * are captured on-visit (gaps happen), so a series is first normalized into
 * per-elapsed-day deltas; projections then either extend the average slope
 * (linearProjection) or bootstrap-resample the observed deltas (monteCarloProjection)
 * to produce a P10/P50/P90 confidence band. Everything is deterministic: randomness
 * comes only from a caller-provided seed (no Math.random, stable per tenant+day).
 *
 * Honesty: this is extrapolation under a stationarity assumption — the surfaces say so.
 */

export interface SeriesPoint {
  /** ISO date (YYYY-MM-DD). */
  readonly capturedOn: string;
  readonly value: number;
}

export interface BandPoint {
  readonly date: string;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export interface Projection {
  readonly band: readonly BandPoint[];
  readonly terminal: { readonly p10: number; readonly p50: number; readonly p90: number };
  readonly basis: "monte_carlo";
}

/** Minimum snapshots before any projection is trusted. */
export const MIN_POINTS = 5;

/** Runs beyond this horizon are reported as "beyond horizon" (null dates). */
export const MAX_COMPLETION_HORIZON_DAYS = 730;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + a string hash so a seed can be derived from
// stable keys like `${tenantId}:${today}`.
// ---------------------------------------------------------------------------

export function seedFrom(key: string): number {
  // FNV-1a 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Series helpers
// ---------------------------------------------------------------------------

export function sortSeries(points: readonly SeriesPoint[]): SeriesPoint[] {
  return [...points].sort((a, b) => (a.capturedOn < b.capturedOn ? -1 : a.capturedOn > b.capturedOn ? 1 : 0));
}

/**
 * Per-elapsed-day deltas between consecutive snapshots: a 3-day gap contributes its
 * change divided by 3 (one sample), so on-visit capture gaps don't inflate steps.
 * Duplicate/misordered dates (non-positive gaps) are skipped.
 */
export function normalizeDeltas(points: readonly SeriesPoint[]): number[] {
  const sorted = sortSeries(points);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1]!.capturedOn, sorted[i]!.capturedOn);
    if (gap <= 0) continue;
    deltas.push((sorted[i]!.value - sorted[i - 1]!.value) / gap);
  }
  return deltas;
}

function clampValue(v: number, floor: number | null, cap: number | null): number {
  let out = v;
  if (floor !== null && out < floor) out = floor;
  if (cap !== null && out > cap) out = cap;
  return out;
}

/** Linear-interpolated percentile of an ASCENDING-sorted array (q in [0,1]). */
function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface LinearProjection {
  readonly slopePerDay: number;
  readonly projected: readonly SeriesPoint[];
}

export interface ProjectionOptions {
  readonly horizonDays: number;
  readonly floor?: number | null;
  readonly cap?: number | null;
}

/** Average-slope extension of the series. Null under MIN_POINTS or a zero-day span. */
export function linearProjection(
  points: readonly SeriesPoint[],
  opts: ProjectionOptions,
): LinearProjection | null {
  const sorted = sortSeries(points);
  if (sorted.length < MIN_POINTS) return null;
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = daysBetween(first.capturedOn, last.capturedOn);
  if (span <= 0) return null;
  const slope = (last.value - first.value) / span;
  const floor = opts.floor === undefined ? 0 : opts.floor;
  const cap = opts.cap ?? null;
  const projected: SeriesPoint[] = [];
  for (let d = 1; d <= opts.horizonDays; d++) {
    projected.push({
      capturedOn: addDays(last.capturedOn, d),
      value: round2(clampValue(last.value + slope * d, floor, cap)),
    });
  }
  return { slopePerDay: round2(slope), projected };
}

export interface MonteCarloOptions extends ProjectionOptions {
  readonly seed: number;
  readonly runs?: number;
}

/**
 * Bootstrap Monte-Carlo: resample the observed per-day deltas (with replacement) and
 * walk the horizon `runs` times; report the P10/P50/P90 envelope per day. Same seed →
 * identical output. Null under MIN_POINTS or when no usable deltas exist.
 */
export function monteCarloProjection(
  points: readonly SeriesPoint[],
  opts: MonteCarloOptions,
): Projection | null {
  const sorted = sortSeries(points);
  if (sorted.length < MIN_POINTS) return null;
  const deltas = normalizeDeltas(sorted);
  if (deltas.length === 0) return null;

  const runs = opts.runs ?? 500;
  const floor = opts.floor === undefined ? 0 : opts.floor;
  const cap = opts.cap ?? null;
  const last = sorted[sorted.length - 1]!;
  const rng = mulberry32(opts.seed);

  // perDay[d] = the simulated values across runs at day d+1.
  const perDay: number[][] = Array.from({ length: opts.horizonDays }, () => []);
  for (let r = 0; r < runs; r++) {
    let v = last.value;
    for (let d = 0; d < opts.horizonDays; d++) {
      v = clampValue(v + deltas[Math.floor(rng() * deltas.length)]!, floor, cap);
      perDay[d]!.push(v);
    }
  }

  const band: BandPoint[] = perDay.map((vals, d) => {
    const s = [...vals].sort((a, b) => a - b);
    return {
      date: addDays(last.capturedOn, d + 1),
      p10: round2(percentile(s, 0.1)),
      p50: round2(percentile(s, 0.5)),
      p90: round2(percentile(s, 0.9)),
    };
  });

  const terminal = band[band.length - 1]!;
  return { band, terminal: { p10: terminal.p10, p50: terminal.p50, p90: terminal.p90 }, basis: "monte_carlo" };
}

// ---------------------------------------------------------------------------
// Roadmap completion: walk the done-count forward until it reaches `total`.
// ---------------------------------------------------------------------------

export interface CompletionOptions {
  readonly seed: number;
  readonly runs?: number;
  readonly plannedEnd?: string | null;
  readonly horizonDays?: number;
}

export interface CompletionForecast {
  /** Median completion date; null when >=50% of runs never finish inside the horizon. */
  readonly p50Date: string | null;
  /** 90th-percentile (pessimistic) completion date; null when it exceeds the horizon. */
  readonly p90Date: string | null;
  /** Share of runs finishing by plannedEnd (0..1); null without a plannedEnd. */
  readonly hitProbability: number | null;
  readonly basis: "monte_carlo";
}

/**
 * Monte-Carlo roadmap completion over the burn-up `done` series. Sampled steps are
 * clamped at >= 0 (progress walks forward; a reopened milestone is noise, not a trend).
 * Null under MIN_POINTS — callers fall back to the linear computeForecast.
 */
export function roadmapCompletionMC(
  points: readonly SeriesPoint[],
  total: number,
  today: string,
  opts: CompletionOptions,
): CompletionForecast | null {
  const sorted = sortSeries(points);
  if (sorted.length < MIN_POINTS || total <= 0) return null;
  const deltas = normalizeDeltas(sorted).map((d) => Math.max(0, d));
  if (deltas.length === 0) return null;

  const last = sorted[sorted.length - 1]!;
  if (last.value >= total) {
    return { p50Date: today, p90Date: today, hitProbability: opts.plannedEnd ? 1 : null, basis: "monte_carlo" };
  }

  const runs = opts.runs ?? 500;
  const horizon = opts.horizonDays ?? MAX_COMPLETION_HORIZON_DAYS;
  const rng = mulberry32(opts.seed);
  const plannedDays = opts.plannedEnd ? daysBetween(today, opts.plannedEnd) : null;

  // Days-to-complete per run; Infinity when the horizon is exceeded.
  const completions: number[] = [];
  let hit = 0;
  for (let r = 0; r < runs; r++) {
    let v = last.value;
    let days = 0;
    while (v < total && days < horizon) {
      v += deltas[Math.floor(rng() * deltas.length)]!;
      days++;
    }
    const done = v >= total;
    completions.push(done ? days : Number.POSITIVE_INFINITY);
    if (done && plannedDays !== null && days <= plannedDays) hit++;
  }

  completions.sort((a, b) => a - b);
  const p50 = percentile(completions, 0.5);
  const p90 = percentile(completions, 0.9);
  return {
    p50Date: Number.isFinite(p50) ? addDays(today, Math.ceil(p50)) : null,
    p90Date: Number.isFinite(p90) ? addDays(today, Math.ceil(p90)) : null,
    hitProbability: plannedDays !== null ? round2(hit / runs) : null,
    basis: "monte_carlo",
  };
}
