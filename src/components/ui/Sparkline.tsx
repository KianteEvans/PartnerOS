import type { ReactNode } from "react";
import { sparklinePoints } from "@/domain/trend";

/**
 * Tiny pure-SVG trend line for KPI cards. Server-rendered, no deps. Renders nothing
 * for a series shorter than 2 points (a line needs two), so callers can pass whatever
 * history they have and it degrades gracefully. Decorative — the number is the data.
 */
export function Sparkline({
  values,
  color = "var(--accent-2)",
  width = 58,
  height = 20,
}: {
  values: readonly number[];
  color?: string;
  width?: number;
  height?: number;
}): ReactNode {
  if (values.length < 2) return null;
  const points = sparklinePoints(values, width, height);
  const gid = `sl-${String(color).replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={`${gid}-line`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: color }} />
          <stop offset="100%" style={{ stopColor: `color-mix(in srgb, ${color} 50%, #fff)` }} />
        </linearGradient>
        <linearGradient id={`${gid}-fill`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: `color-mix(in srgb, ${color} 22%, transparent)` }} />
          <stop offset="100%" style={{ stopColor: "transparent" }} />
        </linearGradient>
      </defs>
      {/* Faint area wash under the line (fades to nothing at the baseline). */}
      <polygon points={`${points} ${width},${height} 0,${height}`} fill={`url(#${gid}-fill)`} stroke="none" />
      <polyline
        points={points}
        fill="none"
        stroke={`url(#${gid}-line)`}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="pos-spark-line"
      />
    </svg>
  );
}
