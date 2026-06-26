import type { CSSProperties, ReactNode } from "react";

/**
 * Elevated surface used for the repeated inline "card" rows across sections
 * (Rule 7). Centralizes border + radius + shadow so cards read as raised on the
 * dark theme. `style` merges/overrides; `compact` is the tighter row variant.
 */
export function Card({
  children,
  compact = false,
  interactive = false,
  style,
}: {
  children: ReactNode;
  compact?: boolean;
  interactive?: boolean;
  style?: CSSProperties;
}): ReactNode {
  return (
    <div
      className={interactive ? "card-interactive" : undefined}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: compact ? 8 : "var(--radius)",
        boxShadow: "var(--shadow)",
        padding: compact ? "10px 14px" : 14,
        transition: interactive
          ? "transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease"
          : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
