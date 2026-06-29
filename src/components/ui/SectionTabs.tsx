"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Shared section sub-nav: a pill row that sits at the top of a consolidated
 * section and switches between its stages (e.g. the Program Management lifecycle,
 * the Command Center decisions/tasks split, the Planning assessments/roadmaps
 * split). One source of truth for the look + active-stage logic.
 *
 * Active stage = the tab whose `activeWhen` matches (used for query-param swaps
 * like `?view=solutions`), else the tab whose href is the LONGEST path-prefix of
 * the current pathname — so `/programs/[id]` lights "Pursue" via `/programs` while
 * `/programs/evidence/fit` lights "Prove" via the longer `/programs/evidence`.
 */
export type SectionTab = {
  readonly key: string;
  readonly label: string;
  readonly caption: string;
  readonly href: string;
  readonly activeWhen?: (pathname: string, view: string | null) => boolean;
};

export function SectionTabs({
  ariaLabel,
  tabs,
}: {
  ariaLabel: string;
  tabs: readonly SectionTab[];
}): ReactNode {
  const pathname = usePathname();
  const view = useSearchParams().get("view");

  let activeKey = tabs[0]?.key;
  const explicit = tabs.find((t) => t.activeWhen?.(pathname, view));
  if (explicit) {
    activeKey = explicit.key;
  } else {
    let bestLen = -1;
    for (const t of tabs) {
      const base = t.href.split("?")[0]!;
      if ((pathname === base || pathname.startsWith(`${base}/`)) && base.length > bestLen) {
        bestLen = base.length;
        activeKey = t.key;
      }
    }
  }

  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: 6,
        padding: 4,
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        flexWrap: "wrap",
      }}
    >
      {tabs.map((t) => {
        const isActive = t.key === activeKey;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            style={{
              flex: "1 1 0",
              minWidth: 120,
              display: "grid",
              gap: 1,
              padding: "8px 14px",
              borderRadius: 10,
              textDecoration: "none",
              textAlign: "center",
              background: isActive ? "var(--panel)" : "transparent",
              boxShadow: isActive ? "var(--shadow-sm)" : "none",
              border: isActive ? "1px solid var(--border)" : "1px solid transparent",
              borderTop: isActive ? "2px solid var(--section-accent)" : "2px solid transparent",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: isActive ? "var(--section-accent)" : "var(--text)" }}>
              {t.label}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{t.caption}</span>
          </Link>
        );
      })}
    </nav>
  );
}
