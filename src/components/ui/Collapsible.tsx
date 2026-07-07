"use client";

import { useId, useState, type ReactNode } from "react";
import { IconChevron } from "@/components/ui/icons";
import {
  COLLAPSE_COOKIE,
  COLLAPSE_MAX_AGE,
  parseCollapsed,
  serializeCollapsed,
  toggleKey,
} from "@/domain/ui/collapse";

/**
 * Client interactivity for the collapse preference. The server (Panel /
 * MetricCard) resolves the key + initial state from the cookie and passes them
 * in, so `useState(initialCollapsed)` matches SSR exactly — no hydration
 * mismatch, no flash. Bodies are hidden via the `hidden` attribute (kept
 * mounted) so forms inside a collapsed panel keep their state. Toggling writes
 * the cookie directly; the next render/navigation reads it server-side.
 */

function readCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${COLLAPSE_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(COLLAPSE_COOKIE.length + 1)) : undefined;
}

function writeCollapseCookie(key: string, collapsed: boolean): void {
  const next = serializeCollapsed(toggleKey(parseCollapsed(readCookie()), key, collapsed));
  const base = `${COLLAPSE_COOKIE}=${encodeURIComponent(next)}; path=/; samesite=lax`;
  document.cookie = next.length > 0 ? `${base}; max-age=${COLLAPSE_MAX_AGE}` : `${base}; max-age=0`;
}

function Chevron({ collapsed }: { collapsed: boolean }): ReactNode {
  return (
    <span
      className="collapse-chevron"
      aria-hidden
      style={{ display: "inline-flex", color: "var(--muted)", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}
    >
      <IconChevron dir="right" size={16} />
    </span>
  );
}

const toggleButtonBase = {
  background: "transparent",
  border: 0,
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
  textAlign: "left" as const,
};

/** Panel-level module collapse: the header is the toggle; actions stay outside it. */
export function CollapsibleSection({
  collapseKey,
  initialCollapsed,
  title,
  accentColor,
  actions,
  children,
}: {
  collapseKey: string;
  initialCollapsed: boolean;
  title: string;
  accentColor?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const bodyId = useId();
  function toggle(): void {
    setCollapsed((c) => {
      writeCollapseCookie(collapseKey, !c);
      return !c;
    });
  }
  return (
    <>
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: collapsed ? 0 : 16 }}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className="collapse-header"
          style={{ ...toggleButtonBase, display: "flex", alignItems: "center", gap: 8, color: accentColor ?? "var(--text)", flex: 1, minWidth: 0 }}
        >
          <Chevron collapsed={collapsed} />
          <h2 style={{ margin: 0, fontSize: 16, color: accentColor }}>{title}</h2>
        </button>
        {actions ? <div style={{ flexShrink: 0 }}>{actions}</div> : null}
      </header>
      <div id={bodyId} hidden={collapsed}>
        {children}
      </div>
    </>
  );
}

/**
 * Per-card KPI collapse: label + chevron stay visible; the value row (`above`)
 * and delta/sub (`below`) hide. Chevron sits beside the label (never over the
 * sparkline). Collapsed = just the label + chevron.
 */
export function CollapsibleCardBody({
  collapseKey,
  initialCollapsed,
  label,
  icon,
  above,
  below,
}: {
  collapseKey: string;
  initialCollapsed: boolean;
  label: string;
  icon?: ReactNode;
  above?: ReactNode;
  below?: ReactNode;
}): ReactNode {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const bodyId = useId();
  function toggle(): void {
    setCollapsed((c) => {
      writeCollapseCookie(collapseKey, !c);
      return !c;
    });
  }
  return (
    <>
      {above ? (
        <div id={`${bodyId}-a`} hidden={collapsed}>
          {above}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: above && !collapsed ? 4 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12.5, color: "var(--text)" }}>
          {icon}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          className="collapse-header"
          style={{ ...toggleButtonBase, display: "inline-flex", alignItems: "center", flexShrink: 0 }}
        >
          <Chevron collapsed={collapsed} />
        </button>
      </div>
      {below ? (
        <div id={bodyId} hidden={collapsed}>
          {below}
        </div>
      ) : null}
    </>
  );
}
