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
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <polyline
        points={sparklinePoints(values, width, height)}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
