import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { daysBetween } from "@/domain/dates";

/**
 * Shared "attention item" — the canonical render for a risk / decision / status
 * that needs a look, promoted out of the three divergent inline copies (command
 * `DecisionRow`, home `DecisionRow`, and portfolio's bare left-stripe grid).
 * Presentational + sync; each page maps its own shape onto these props (no
 * `Decision` import here). Severity drives the tone via the shared `statusTone`.
 *
 * - `variant="row"` (default): a whole-card drill-through — `<Link><Card interactive>`
 *   with a bold plain-text title (NOT an orange link), a severity `Badge`, a
 *   single-line detail, and a right rail of owner + due-date urgency.
 * - `variant="hero"`: a single lone item — a severity-toned `Callout` (stripe +
 *   wash give it the visual anchor a bare card lacks) + owner·due meta + a CTA.
 *
 * Due-date urgency uses `daysBetween` on the `YYYY-MM-DD` strings (never
 * `relativeTime`, which is epoch-millis): overdue -> danger, <=7d -> warn, else muted.
 */

export interface AttentionItemProps {
  severity: string;
  title: string;
  detail: string;
  href: string;
  owner?: string | null;
  dueDate?: string | null;
  today?: string | null;
  variant?: "row" | "hero";
  /** Hero-only call-to-action label, e.g. "Review ->" / "Decide ->". */
  cta?: string;
}

function urgencyOf(
  today: string | null | undefined,
  dueDate: string | null | undefined,
): { text: string; color: string } | null {
  if (!today || !dueDate) return null;
  const days = daysBetween(today, dueDate);
  if (days < 0) return { text: `overdue ${Math.abs(days)}d`, color: "var(--danger)" };
  if (days <= 7) return { text: `due in ${days}d`, color: "var(--warn)" };
  return { text: `due ${dueDate}`, color: "var(--muted)" };
}

export function AttentionItem({
  severity,
  title,
  detail,
  href,
  owner,
  dueDate,
  today,
  variant = "row",
  cta,
}: AttentionItemProps): ReactNode {
  const urgency = urgencyOf(today, dueDate);

  if (variant === "hero") {
    const hasMeta = Boolean(owner) || urgency !== null || Boolean(dueDate);
    return (
      <Callout tone={statusTone(severity)} title={title}>
        <div>{detail}</div>
        {hasMeta ? (
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
            {owner ? owner : null}
            {owner && (urgency || dueDate) ? " · " : null}
            {urgency ? (
              <span style={{ color: urgency.color, fontWeight: 600 }}>{urgency.text}</span>
            ) : dueDate ? (
              `due ${dueDate}`
            ) : null}
          </div>
        ) : null}
        {cta ? (
          <Link
            href={href}
            style={{ display: "inline-block", marginTop: 9, fontSize: 12, fontWeight: 600, color: "var(--section-accent)", textDecoration: "none" }}
          >
            {cta}
          </Link>
        ) : null}
      </Callout>
    );
  }

  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <Card compact interactive style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Badge tone={statusTone(severity)}>{severity}</Badge>
            <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </span>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 12, margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {detail}
          </p>
        </div>
        {owner || urgency ? (
          <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>
            {owner}
            {urgency ? (
              <>
                <br />
                <span style={{ color: urgency.color, fontWeight: 600 }}>{urgency.text}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </Card>
    </Link>
  );
}

/**
 * Thin list wrapper: renders an `EmptyState` when there are no items, else the
 * rows in a consistent gap grid. Each item carries a stable `key`.
 */
export function AttentionList({
  items,
  empty,
}: {
  items: ReadonlyArray<AttentionItemProps & { key: string }>;
  empty?: { title: string; hint?: string };
}): ReactNode {
  if (items.length === 0) {
    return <EmptyState title={empty?.title ?? "All clear"} {...(empty?.hint ? { hint: empty.hint } : {})} />;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map(({ key, ...props }) => (
        <AttentionItem key={key} {...props} />
      ))}
    </div>
  );
}
