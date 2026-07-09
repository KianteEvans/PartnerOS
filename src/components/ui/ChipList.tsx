import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Compact list of "thing + status" rows — a reset `<ul>` where each row is a
 * label (optionally a section-accent link, optionally with a stacked muted
 * `detail` subline) on the left and a `badges` cluster on the right. Promoted
 * from the repeated inline lists on detail pages (marketplace listings, linked
 * opportunities, renewal criteria, assessment strengths). Presentational + sync.
 */
export function ChipList({
  items,
  empty,
}: {
  items: ReadonlyArray<{ key: string; label: ReactNode; detail?: ReactNode; href?: string; badges: ReactNode }>;
  empty?: ReactNode;
}): ReactNode {
  if (items.length === 0) return empty ?? null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
      {items.map((it) => (
        <li key={it.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: it.detail ? "flex-start" : "center", flexWrap: "wrap" }}>
          {it.detail ? (
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              {it.href ? (
                <Link href={it.href} style={{ fontSize: 13, color: "var(--section-accent)", textDecoration: "none" }}>{it.label}</Link>
              ) : (
                <span style={{ fontSize: 13 }}>{it.label}</span>
              )}
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{it.detail}</span>
            </div>
          ) : it.href ? (
            <Link href={it.href} style={{ fontSize: 13, color: "var(--section-accent)", textDecoration: "none", minWidth: 0 }}>{it.label}</Link>
          ) : (
            <span style={{ fontSize: 13, minWidth: 0 }}>{it.label}</span>
          )}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>{it.badges}</div>
        </li>
      ))}
    </ul>
  );
}
