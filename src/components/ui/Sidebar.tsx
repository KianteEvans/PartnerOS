"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/ui/Brand";
import { TOGGLE_NAV_EVENT } from "@/components/ui/TopBar";
import { isPathIncluded, type PackageTier } from "@/domain/packaging/catalog";
import {
  IconHome,
  IconCommand,
  IconPortfolio,
  IconRoadmaps,
  IconPrograms,
  IconAce,
  IconMdf,
  IconFunding,
  IconPlaybook,
  IconMarketplace,
  IconReports,
  IconSettings,
  IconChevron,
  type IconProps,
} from "@/components/ui/icons";

/**
 * Persistent global navigation. Lists every section, highlights the active one
 * (so `/mdf/[id]` keeps MDF lit), and collapses to a 64px icon rail whose state
 * persists in localStorage. The signed-in user + sign-out live in the footer.
 *
 * Responsive: below `MOBILE_BREAKPOINT` the rail is replaced by a fixed top bar
 * with a hamburger; the nav becomes an off-canvas drawer (with backdrop) that
 * opens over the content and closes on navigation. The desktop collapse state
 * is ignored on mobile so the drawer always shows full labels.
 */
type NavItem = { href: string; label: string; Icon: (p: IconProps) => ReactNode };

// Grouped by the partner lifecycle (plan -> build -> co-sell -> measure) so the
// nav reads as designed-for-partners rather than a flat 15-item feature list.
const NAV_GROUPS: ReadonlyArray<{ label: string; items: readonly NavItem[] }> = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Home", Icon: IconHome },
      { href: "/command", label: "Command Center", Icon: IconCommand },
      { href: "/playbooks", label: "Playbooks", Icon: IconPlaybook },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/plan", label: "Planning", Icon: IconRoadmaps },
    ],
  },
  {
    label: "Build & comply",
    items: [
      { href: "/programs", label: "Program Management", Icon: IconPrograms },
    ],
  },
  {
    label: "Co-sell & revenue",
    items: [
      { href: "/ace", label: "ACE Pipeline", Icon: IconAce },
      { href: "/mdf", label: "MDF", Icon: IconMdf },
      { href: "/funding", label: "AWS Funding", Icon: IconFunding },
      { href: "/marketplace", label: "Marketplace", Icon: IconMarketplace },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/reports", label: "Reports", Icon: IconReports },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings", Icon: IconSettings },
    ],
  },
];

const STORAGE_KEY = "partneros:sidebar";
const MOBILE_BREAKPOINT = 760;

/**
 * Agencies get an extra "Portfolio" item in the Overview group (Bet C). A
 * package preview hides sections outside the simulated tier (empty groups
 * disappear too, so an Essentials nav reads as the real Essentials product).
 */
function navGroups(
  isAgency: boolean,
  previewTier: PackageTier | null,
): ReadonlyArray<{ label: string; items: readonly NavItem[] }> {
  const base = !isAgency
    ? NAV_GROUPS
    : NAV_GROUPS.map((g) =>
        g.label === "Overview"
          ? { ...g, items: [...g.items, { href: "/portfolio", label: "Portfolio", Icon: IconPortfolio }] }
          : g,
      );
  if (previewTier === null) return base;
  return base
    .map((g) => ({ ...g, items: g.items.filter((i) => isPathIncluded(previewTier, i.href)) }))
    .filter((g) => g.items.length > 0);
}

export function Sidebar({
  email,
  isAgency = false,
  previewTier = null,
}: {
  email: string;
  isAgency?: boolean;
  previewTier?: PackageTier | null;
}): ReactNode {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "collapsed");
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const sync = (): void => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // The top bar's hamburger lives in a separate component; it asks us to open
  // the drawer via a window event (no shared provider needed in the server layout).
  useEffect(() => {
    const open = (): void => setMobileOpen(true);
    window.addEventListener(TOGGLE_NAV_EVENT, open);
    return () => window.removeEventListener(TOGGLE_NAV_EVENT, open);
  }, []);

  function toggleCollapsed(): void {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_KEY, next ? "collapsed" : "expanded");
      return next;
    });
  }

  // On mobile the rail/collapse concept doesn't apply — always show full labels.
  const railCollapsed = !isMobile && collapsed;
  const width = isMobile ? 264 : railCollapsed ? 64 : 230;

  const navStyle = isMobile
    ? ({
        width,
        position: "fixed",
        top: 0,
        left: 0,
        height: "100vh",
        zIndex: 60,
        transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.22s ease",
        boxShadow: mobileOpen ? "0 0 40px rgba(0,0,0,0.5)" : "none",
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        borderRight: "1px solid var(--border)",
      } as const)
    : ({
        width,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--panel)",
        borderRight: "1px solid var(--border)",
      } as const);

  return (
    <>
      {isMobile && mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(0,0,0,0.5)",
          }}
        />
      )}

      <nav aria-label="Sections" style={navStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: railCollapsed ? "center" : "space-between",
            padding: railCollapsed ? "14px 0" : "14px 16px",
            minHeight: 58,
          }}
        >
          <Brand iconOnly={railCollapsed} size={railCollapsed ? 26 : 28} />
          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div
          style={{
            padding: railCollapsed ? "4px 8px" : "6px 12px",
            display: "grid",
            gap: 2,
            flex: 1,
            alignContent: "start",
          }}
        >
          {navGroups(isAgency, previewTier).map((group, gi) => (
            <div key={group.label} style={{ display: "grid", gap: 2 }}>
              {railCollapsed ? (
                gi > 0 ? (
                  <div aria-hidden="true" style={{ borderTop: "1px solid var(--border)", margin: "7px 6px" }} />
                ) : null
              ) : (
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                    padding: gi === 0 ? "2px 11px 4px" : "13px 11px 4px",
                  }}
                >
                  {group.label}
                </div>
              )}
              {group.items.map(({ href, label, Icon }) => {
                const active =
                  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    title={railCollapsed ? label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={active ? "sidebar-link active" : "sidebar-link"}
                    onClick={() => setMobileOpen(false)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      justifyContent: railCollapsed ? "center" : "flex-start",
                      padding: railCollapsed ? "9px 0" : "9px 11px",
                      borderRadius: 8,
                      textDecoration: "none",
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 500,
                      color: active ? "var(--section-accent)" : "var(--muted)",
                      background: active
                        ? "color-mix(in srgb, var(--section-accent) 14%, transparent)"
                        : "transparent",
                      borderLeft: active ? "2px solid var(--section-accent)" : "2px solid transparent",
                    }}
                  >
                    <Icon size={18} />
                    {!railCollapsed && <span>{label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {!isMobile && (
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              margin: collapsed ? "6px 8px" : "6px 12px",
              padding: "7px 0",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <IconChevron size={16} dir={collapsed ? "right" : "left"} />
            {!collapsed && <span>Collapse</span>}
          </button>
        )}

        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: railCollapsed ? "12px 8px" : "12px 14px",
            display: "grid",
            gap: 8,
          }}
        >
          {!railCollapsed && (
            <span
              title={email}
              style={{
                fontSize: 12,
                color: "var(--muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {email}
            </span>
          )}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              title="Sign out"
              style={{
                width: "100%",
                padding: railCollapsed ? "7px 0" : "7px 10px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 12.5,
              }}
            >
              {railCollapsed ? "⎋" : "Sign out"}
            </button>
          </form>
        </div>
      </nav>
    </>
  );
}
