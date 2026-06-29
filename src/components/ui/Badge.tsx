import type { ReactNode } from "react";

/**
 * Semantic status pill (Rule 7). A tinted background + the tone color keeps the
 * orange brand for actions while statuses scan green/amber/red at a glance.
 */
export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

/** Tone -> CSS colour var. Reused by Panel accent + Callout so the tone palette
 *  has a single source of truth. */
export const TONE_VAR: Record<Tone, string> = {
  neutral: "var(--muted)",
  accent: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
};

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}): ReactNode {
  const color = TONE_VAR[tone];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: "0.01em",
        textTransform: "capitalize",
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
        borderRadius: 999,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Map common domain status strings to a tone. Unknown -> neutral. */
export function statusTone(status: string): Tone {
  switch (status) {
    // success / done / good
    case "approved":
    case "met":
    case "active":
    case "won":
    case "reimbursed":
    case "clean":
    case "healthy":
    case "ready_for_roadmap":
    case "strong":
    case "completed":
    case "done":
    case "achieved":
    case "finalized":
    case "exported":
    case "participating":
    case "current":
    case "configured":
      return "ok";
    // in-flight / informational
    case "requested":
    case "in_review":
    case "in_progress":
    case "routed":
    case "reviewed":
    case "submitted":
    case "deployed":
    case "collected":
    case "developing":
      return "info";
    // attention / pending / warning
    case "pending":
    case "draft":
    case "expiring":
    case "renewal_risk":
    case "stale":
    case "fair":
    case "needs_evidence":
    case "claimed":
    case "weak":
    case "unrouted":
    case "high":
      return "warn";
    // problems
    case "rejected":
    case "overdue":
    case "expired":
    case "lost":
    case "critical":
    case "error":
    case "submission_blocked":
    case "at_risk":
    case "blocked":
    case "missing":
    case "disabled":
      return "danger";
    default:
      return "neutral";
  }
}
