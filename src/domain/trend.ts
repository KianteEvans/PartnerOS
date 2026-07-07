/**
 * Pure trend helpers for sparklines + delta chips. No DB, no clock — given a series
 * of historical metric values, produce the SVG polyline geometry and the most-recent
 * change. Deterministic and unit-testable; the SVG/JSX lives in the Sparkline/DeltaChip
 * primitives, the math lives here.
 */

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * SVG polyline "points" for a sparkline. X is evenly spaced; Y is inverted so a
 * higher value sits higher on screen. A flat series (no spread) degrades to a
 * centered horizontal line; a single point centers.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const pad = 1.5;
  const w = Math.max(1, width - pad * 2);
  const h = Math.max(1, height - pad * 2);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const n = values.length;
  return values
    .map((v, i) => {
      const x = pad + (n === 1 ? w / 2 : (i / (n - 1)) * w);
      const y = pad + (span === 0 ? h / 2 : (1 - (v - min) / span) * h);
      return `${round1(x)},${round1(y)}`;
    })
    .join(" ");
}

/** Most-recent change in a series (last - previous). null when fewer than 2 points. */
export function trendDelta(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  return values[values.length - 1]! - values[values.length - 2]!;
}

/** Sparkline + delta-chip payload for a MetricCard (the `trend` prop). */
export interface MetricTrend {
  readonly values: readonly number[];
  readonly delta: number | null;
  readonly invert?: boolean | undefined;
  readonly deltaSuffix?: string | undefined;
}

/**
 * Build a MetricTrend from a raw 14-day metric series. Returns undefined for a
 * series shorter than 2 points (a line needs two, a delta needs a prior value),
 * so a card fed thin history simply falls back to its `sub` text.
 */
export function mkTrend(
  series: readonly number[],
  opts?: { invert?: boolean; suffix?: string },
): MetricTrend | undefined {
  if (series.length < 2) return undefined;
  return { values: series, delta: trendDelta(series), invert: opts?.invert, deltaSuffix: opts?.suffix };
}
