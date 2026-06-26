import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Link-based segmented control for mutually-exclusive mode/view toggles. The active
 * segment is raised on the panel surface; each segment is a Next <Link> so it works
 * in server components with no client JS. Replaces the hand-rolled pill rows that
 * were duplicated across the Command Center, Programs, and ACE headers.
 */

export interface SegmentOption {
  readonly value: string;
  readonly label: string;
}

export function SegmentedControl({
  options,
  value,
  hrefFor,
  size = "md",
}: {
  options: readonly SegmentOption[];
  value: string;
  hrefFor: (value: string) => string;
  size?: "sm" | "md";
}): ReactNode {
  const padding = size === "sm" ? "4px 10px" : "5px 13px";
  const fontSize = size === "sm" ? 12 : 12.5;
  return (
    <div style={{ display: "inline-flex", background: "var(--panel-2)", borderRadius: 9, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Link
            key={o.value}
            href={hrefFor(o.value)}
            aria-current={active ? "page" : undefined}
            style={{
              fontSize,
              fontWeight: active ? 600 : 500,
              padding,
              borderRadius: 7,
              textDecoration: "none",
              background: active ? "var(--panel)" : "transparent",
              color: active ? "var(--text)" : "var(--muted)",
              boxShadow: active ? "var(--shadow-sm)" : undefined,
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
