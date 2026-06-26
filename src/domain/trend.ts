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
