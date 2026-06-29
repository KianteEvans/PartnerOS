import type { ReactNode } from "react";
import { TONE_VAR, type Tone } from "@/components/ui/Badge";

/**
 * Inline notice block — a left accent bar + a faint tone-tinted wash + an optional
 * tone-coloured title. For deadline warnings, fit nudges, empty-state hints, etc.
 * Reuses the shared `Tone` palette so it scans the same green/amber/red as Badge.
 */
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}): ReactNode {
  const color = TONE_VAR[tone];
  return (
    <div
      style={{
        padding: "11px 14px",
        borderRadius: "var(--radius)",
        // border shorthand first, then override the left edge to the 3px accent bar.
        border: `1px solid color-mix(in srgb, ${color} 22%, var(--border))`,
        borderLeft: `3px solid ${color}`,
        background: `color-mix(in srgb, ${color} 8%, var(--panel))`,
        display: "grid",
        gap: 2,
      }}
    >
      {title ? <strong style={{ fontSize: 13, color }}>{title}</strong> : null}
      {children ? <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.45 }}>{children}</div> : null}
    </div>
  );
}
