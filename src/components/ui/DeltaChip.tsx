import type { CSSProperties, ReactNode } from "react";

/**
 * Small trend-delta pill (▲ +3 / ▼ -2). By default an increase is "good" (green);
 * pass `invert` for metrics where rising is bad (overdue, at-risk). A zero delta is
 * neutral. The `suffix` lets callers append a unit (e.g. "%").
 */
function chipStyle(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 11,
    fontWeight: 600,
    color,
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    borderRadius: 999,
    padding: "0 6px",
    lineHeight: 1.6,
    whiteSpace: "nowrap",
  };
}

export function DeltaChip({
  delta,
  suffix = "",
  invert = false,
  pulse = false,
}: {
  delta: number;
  suffix?: string | undefined;
  invert?: boolean | undefined;
  /** Opt-in one-shot pulse to draw the eye to a notable swing (reduced-motion safe). */
  pulse?: boolean | undefined;
}): ReactNode {
  if (delta === 0) {
    return <span style={chipStyle("var(--muted)")}>±0{suffix}</span>;
  }
  const up = delta > 0;
  const good = invert ? !up : up;
  const color = good ? "var(--ok)" : "var(--danger)";
  return (
    <span style={chipStyle(color)} className={pulse ? "pos-delta-pulse" : undefined}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {delta}
      {suffix}
    </span>
  );
}
