import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Server-side pagination control. The page builds prev/next hrefs (preserving
 * search + sort) and passes the current page, total pages, and total row count.
 * Rendered only when there's more than one page.
 */
export function Pagination({
  page,
  totalPages,
  total,
  prevHref,
  nextHref,
}: {
  page: number;
  totalPages: number;
  total: number;
  prevHref: string;
  nextHref: string;
}): ReactNode {
  if (totalPages <= 1) return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 14,
        fontSize: 13,
        color: "var(--muted)",
      }}
    >
      <span>
        Page {page} of {totalPages} · {total.toLocaleString()} total
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <PageLink href={prevHref} disabled={page <= 1}>
          ← Prev
        </PageLink>
        <PageLink href={nextHref} disabled={page >= totalPages}>
          Next →
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: ReactNode;
}): ReactNode {
  const style = {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    fontSize: 13,
    textDecoration: "none",
  } as const;
  if (disabled) {
    return <span style={{ ...style, color: "var(--muted)", opacity: 0.5 }}>{children}</span>;
  }
  return (
    <Link href={href} style={{ ...style, color: "var(--text)" }}>
      {children}
    </Link>
  );
}
