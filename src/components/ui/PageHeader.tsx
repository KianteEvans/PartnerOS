import type { ReactNode } from "react";
import Link from "next/link";
import { IconChevron } from "@/components/ui/icons";

/**
 * The shared page title block: an optional up-nav back-link, the `<h1>`, an
 * optional subtitle, and a right-aligned actions slot (toggles, "New X" CTAs,
 * exports). Replaces the per-page bespoke header flex rows so every section's
 * title sits at the same baseline and spacing (Rule 7).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  breadcrumbs,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Breadcrumb trail; the last item is the current page (rendered un-linked).
      Takes precedence over `back`. */
  breadcrumbs?: ReadonlyArray<{ href?: string; label: string }>;
}): ReactNode {
  return (
    <header style={{ display: "grid", gap: back || breadcrumbs?.length ? 10 : 0 }}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav
          aria-label="Breadcrumb"
          style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13 }}
        >
          {breadcrumbs.map((c, i) => {
            const last = i === breadcrumbs.length - 1;
            return (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {i > 0 && (
                  <span style={{ color: "var(--muted)" }} aria-hidden="true">
                    /
                  </span>
                )}
                {c.href && !last ? (
                  <Link href={c.href} style={{ color: "var(--muted)", textDecoration: "none" }}>
                    {c.label}
                  </Link>
                ) : (
                  <span
                    style={{ color: last ? "var(--text)" : "var(--muted)" }}
                    aria-current={last ? "page" : undefined}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      ) : back ? (
        <Link
          href={back.href}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            color: "var(--muted)",
            textDecoration: "none",
            fontSize: 13,
            width: "fit-content",
          }}
        >
          <IconChevron size={14} dir="left" />
          {back.label}
        </Link>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.01em" }}>{title}</h1>
          {subtitle && (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>{subtitle}</p>
          )}
        </div>
        {actions && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
