"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Brand } from "@/components/ui/Brand";
import { OPEN_PALETTE_EVENT } from "@/components/ui/CommandPalette";
import type { Decision, Severity } from "@/domain/command/brief";

/** The window event the mobile hamburger dispatches; Sidebar listens to open. */
export const TOGGLE_NAV_EVENT = "partneros:toggle-nav";

const severityColor = (s: Severity): string =>
  s === "critical" ? "var(--danger)" : s === "high" ? "var(--warn)" : "var(--muted)";

/**
 * Global utility bar pinned to the top of the content column. Hosts the mobile
 * nav hamburger (left, mobile only) and — on every breakpoint — a notification
 * bell and an account center on the right. Both are click-to-open menus that
 * close on outside-click or Escape. Notifications are real (Command Center
 * decisions); the account menu carries identity + sign-out.
 */
export function TopBar({
  email,
  role,
  notifications,
}: {
  email: string;
  role: string;
  notifications: readonly Decision[];
}): ReactNode {
  const [menu, setMenu] = useState<null | "bell" | "account">(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [shortcut, setShortcut] = useState("⌘K");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
    );
    setDensity(
      document.documentElement.getAttribute("data-density") === "compact"
        ? "compact"
        : "comfortable",
    );
    try {
      if (!/mac/i.test(navigator.platform)) setShortcut("Ctrl K");
    } catch {
      /* navigator unavailable — keep the default glyph */
    }
  }, []);

  function toggleTheme(): void {
    const next = theme === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      window.localStorage.setItem("partneros:theme", next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    setTheme(next);
  }

  function toggleDensity(): void {
    const next = density === "compact" ? "comfortable" : "compact";
    if (next === "compact") document.documentElement.setAttribute("data-density", "compact");
    else document.documentElement.removeAttribute("data-density");
    try {
      window.localStorage.setItem("partneros:density", next);
    } catch {
      /* storage unavailable — density still applies for this session */
    }
    setDensity(next);
  }

  useEffect(() => {
    if (menu === null) return;
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const count = notifications.length;
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 56,
        padding: "0 16px",
        borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--panel) 86%, transparent)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Left: mobile-only hamburger + brand */}
      <div className="topbar-mobile-only" style={{ alignItems: "center", gap: 10 }}>
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => window.dispatchEvent(new CustomEvent(TOGGLE_NAV_EVENT))}
          style={iconButtonStyle}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Brand size={22} />
      </div>

      {/* Command palette opener (desktop) */}
      <button
        type="button"
        className="topbar-search"
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
        aria-label="Open command palette"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span style={{ flex: 1, textAlign: "left" }}>Search…</span>
        <kbd>{shortcut}</kbd>
      </button>

      <div style={{ flex: 1 }} />

      {/* Right: bell + account */}
      <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          aria-label={`Notifications${count ? ` (${count})` : ""}`}
          aria-expanded={menu === "bell"}
          onClick={() => setMenu((m) => (m === "bell" ? null : "bell"))}
          style={{ ...iconButtonStyle, position: "relative" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {count > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                borderRadius: 999,
                background: "var(--danger)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid var(--panel)",
              }}
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>

        <button
          type="button"
          aria-label="Account"
          aria-expanded={menu === "account"}
          onClick={() => setMenu((m) => (m === "account" ? null : "account"))}
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "color-mix(in srgb, var(--accent) 18%, transparent)",
            color: "var(--accent)",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {initial}
        </button>

        {menu === "bell" && (
          <Dropdown title="Notifications">
            {count === 0 ? (
              <p style={{ margin: 0, padding: "18px 14px", color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
                You&rsquo;re all caught up. 🎉
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 4, display: "grid", gap: 2, maxHeight: 360, overflowY: "auto" }}>
                {notifications.slice(0, 12).map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.link}
                      onClick={() => setMenu(null)}
                      className="topbar-item"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "10px 1fr",
                        gap: 9,
                        padding: "9px 10px",
                        borderRadius: 8,
                        textDecoration: "none",
                        color: "var(--text)",
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: severityColor(n.severity), marginTop: 5 }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {n.title}
                        </span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>{n.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Dropdown>
        )}

        {menu === "account" && (
          <Dropdown title="Account">
            <div style={{ padding: "10px 14px", display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "capitalize" }}>Role: {role}</span>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", padding: 4, display: "grid", gap: 2 }}>
              <button
                type="button"
                onClick={toggleTheme}
                className="topbar-item"
                style={{
                  ...menuItemStyle,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
                <span aria-hidden="true" style={{ fontSize: 15 }}>
                  {theme === "dark" ? "☀︎" : "☾"}
                </span>
              </button>
              <button
                type="button"
                onClick={toggleDensity}
                className="topbar-item"
                style={{
                  ...menuItemStyle,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <span>{density === "compact" ? "Comfortable rows" : "Compact rows"}</span>
                <span aria-hidden="true" style={{ fontSize: 15 }}>
                  {density === "compact" ? "≡" : "≣"}
                </span>
              </button>
              <Link href="/settings" onClick={() => setMenu(null)} className="topbar-item" style={menuItemStyle}>
                Workspace settings
              </Link>
              <form action="/api/auth/logout" method="post" style={{ display: "grid" }}>
                <button type="submit" className="topbar-item" style={{ ...menuItemStyle, background: "transparent", border: "none", textAlign: "left", cursor: "pointer", color: "var(--danger)", font: "inherit" }}>
                  Sign out
                </button>
              </form>
            </div>
          </Dropdown>
        )}
      </div>
    </header>
  );
}

function Dropdown({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div
      role="menu"
      style={{
        position: "absolute",
        top: 44,
        right: 0,
        width: 320,
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow)",
        zIndex: 40,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  cursor: "pointer",
} as const;

const menuItemStyle = {
  display: "block",
  padding: "8px 10px",
  borderRadius: 8,
  textDecoration: "none",
  fontSize: 13,
  color: "var(--text)",
  width: "100%",
} as const;
