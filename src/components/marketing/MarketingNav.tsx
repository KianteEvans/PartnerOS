"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/ui/Brand";
import { ButtonLink } from "@/components/ui/Button";

/**
 * Public top-nav for the signed-out (marketing) shell. Brand on the left, the
 * marketing pages in the middle (active page highlighted via usePathname), and
 * sign-in / book-a-demo CTAs on the right. Sticky and translucent over --panel to
 * match the rest of the app chrome.
 */
const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
];

export function MarketingNav(): ReactNode {
  const pathname = usePathname();
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-5)",
        padding: "10px 24px",
        borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--panel) 88%, transparent)",
        backdropFilter: "saturate(180%) blur(8px)",
      }}
    >
      <Brand />
      <nav style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", marginLeft: "auto" }}>
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <a
              key={l.href}
              href={l.href}
              className="marketing-nav-link"
              aria-current={active ? "page" : undefined}
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: active ? "var(--text)" : "var(--muted)",
                textDecoration: "none",
              }}
            >
              {l.label}
            </a>
          );
        })}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <ButtonLink href="/api/auth/login" variant="ghost" size="sm" external>
          Sign in
        </ButtonLink>
        <ButtonLink href="/demo" size="sm">
          Book a demo
        </ButtonLink>
      </div>
    </header>
  );
}
