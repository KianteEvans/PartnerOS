import type { ReactNode } from "react";

/**
 * Centered empty-state used wherever a list/table has no rows, replacing the
 * one-line muted "No X yet." strings. A ghosted section icon + title + hint +
 * optional CTA turns a dead end into an onramp. `Table` auto-wraps a plain
 * string `empty` prop in one of these, so existing call sites upgrade for free.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}): ReactNode {
  return (
    <div
      style={{
        display: "grid",
        justifyItems: "center",
        gap: 8,
        textAlign: "center",
        padding: "36px 20px",
        color: "var(--muted)",
      }}
    >
      {icon && (
        <div style={{ opacity: 0.45, color: "var(--muted)", marginBottom: 2 }}>{icon}</div>
      )}
      <div style={{ color: "var(--text)", fontWeight: 600, fontSize: 14 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, maxWidth: 380, lineHeight: 1.5 }}>{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
