import type { ReactNode } from "react";

/**
 * Responsive KPI row — a grid of MetricCards that reflows 4 -> 2 -> 1 columns by
 * available width (no media queries). The shared wrapper for the per-section
 * mini-dashboards, so every section's at-a-glance strip looks identical to the
 * workspace hub and ACE/MDF.
 */
export function MetricStrip({
  children,
  min = 150,
}: {
  children: ReactNode;
  min?: number;
}): ReactNode {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 }}>
      {children}
    </div>
  );
}
