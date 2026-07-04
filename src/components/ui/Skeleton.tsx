import type { ReactNode } from "react";

/**
 * Shimmer placeholder block. Composed into route `loading.tsx` files so a
 * navigation shows structured loading feedback (sidebar stays put) instead of a
 * blank content column while the server component fetches.
 */
export function Skeleton({
  width = "100%",
  height = 12,
  radius = 6,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}): ReactNode {
  return (
    <div
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius }}
    />
  );
}

const panelStyle = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
  boxShadow: "var(--shadow)",
} as const;

/** Page title + subtitle placeholder. */
export function HeaderSkeleton(): ReactNode {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Skeleton width={240} height={26} />
      <Skeleton width={360} height={14} />
    </div>
  );
}

/** A row of section-tab placeholders (for pages with a sub-nav). */
export function TabsSkeleton({ tabs = 5 }: { tabs?: number }): ReactNode {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {Array.from({ length: tabs }, (_, i) => (
        <Skeleton key={i} width={120} height={44} radius={10} />
      ))}
    </div>
  );
}

/** A hero band: a ring gauge + a strip of KPI-card placeholders. */
export function HeroSkeleton({ cards = 4 }: { cards?: number }): ReactNode {
  return (
    <div style={{ ...panelStyle, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <Skeleton width={120} height={120} radius={999} />
      <div
        style={{
          flex: 1,
          minWidth: 244,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} style={{ display: "grid", gap: 8 }}>
            <Skeleton width="60%" height={11} />
            <Skeleton width="80%" height={22} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A panel with an optional title + N table-ish row placeholders. */
export function TableSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }): ReactNode {
  return (
    <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
      {title ? <Skeleton width={160} height={16} /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={12} width={`${Math.max(40, 92 - i * 6)}%`} />
      ))}
    </div>
  );
}
