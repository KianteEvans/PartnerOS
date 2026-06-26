import type { ReactNode } from "react";

export type BarDatum = {
  label: string;
  value: number;
  /** Per-bar override; falls back to the chart `color`. */
  color?: string;
  /** Optional value text override (e.g. a formatted "$1,200"). */
  display?: string;
};

/**
 * Dependency-free horizontal bar chart — one row per datum: label, a track with a
 * filled bar scaled to `max` (or the data peak), and the value. Pure CSS/flex, no
 * client JS, themed via CSS variables. Doubles as a waterfall when the data is
 * passed in descending order with a shared `max`.
 */
export function BarChart({
  data,
  max,
  color = "var(--accent-2)",
  formatValue = (n) => n.toLocaleString(),
}: {
  data: ReadonlyArray<BarDatum>;
  /** Shared denominator for every bar; defaults to the largest value. */
  max?: number | undefined;
  // `| undefined` so a forwarded index-typed/optional color type-checks under
  // exactOptionalPropertyTypes; the default still applies when undefined.
  color?: string | undefined;
  formatValue?: (n: number) => string;
}): ReactNode {
  const peak = max ?? Math.max(1, ...data.map((d) => d.value));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {data.map((d) => {
        const pct = peak <= 0 ? 0 : Math.max(0, Math.min(1, d.value / peak)) * 100;
        return (
          <div
            key={d.label}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(80px, 130px) 1fr auto",
              gap: 12,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--muted)" }}>{d.label}</span>
            <div style={{ height: 10, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: d.color ?? color,
                  borderRadius: 999,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <strong style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {d.display ?? formatValue(d.value)}
            </strong>
          </div>
        );
      })}
    </div>
  );
}
