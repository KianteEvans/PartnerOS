"use client";

import { useState, type ReactNode } from "react";
import { emitToast } from "@/components/ui/toast";

const codeStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  width: "100%",
} as const;

const btn = (variant: "primary" | "secondary" | "danger") =>
  ({
    background:
      variant === "primary"
        ? "var(--accent)"
        : variant === "danger"
          ? "color-mix(in srgb, var(--danger) 12%, transparent)"
          : "transparent",
    color: variant === "primary" ? "var(--accent-ink)" : variant === "danger" ? "var(--danger)" : "var(--text)",
    border:
      variant === "danger"
        ? "1px solid color-mix(in srgb, var(--danger) 45%, transparent)"
        : `1px solid ${variant === "primary" ? "var(--accent)" : "var(--border)"}`,
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  }) as const;

/**
 * SCIM provisioning admin panel. The token is returned once by /api/settings/scim
 * (never re-readable), so it's shown inline after generation with a copy button.
 */
export function ScimPanel({ enabled, baseUrl }: { enabled: boolean; baseUrl: string }): ReactNode {
  const [on, setOn] = useState(enabled);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(action: "rotate" | "disable"): Promise<Record<string, unknown>> {
    const res = await fetch("/api/settings/scim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Record<string, unknown>;
  }

  async function rotate(): Promise<void> {
    setBusy(true);
    try {
      const data = await call("rotate");
      if (typeof data.token === "string") {
        setToken(data.token);
        setOn(true);
        emitToast("SCIM token generated — copy it now.", "ok");
      }
    } catch {
      emitToast("Could not generate the token.", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    setBusy(true);
    try {
      await call("disable");
      setOn(false);
      setToken(null);
      emitToast("SCIM provisioning disabled.", "ok");
    } catch {
      emitToast("Could not disable SCIM.", "danger");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(
      () => emitToast("Copied.", "ok"),
      () => emitToast("Copy failed — select and copy manually.", "danger"),
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
        Connect your identity provider&rsquo;s directory sync (Okta, Entra ID, …) to
        automatically provision and deprovision members via SCIM 2.0. Status:{" "}
        <strong style={{ color: on ? "var(--ok)" : "var(--muted)" }}>
          {on ? "enabled" : "not configured"}
        </strong>
        .
      </p>

      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        <span style={{ color: "var(--muted)" }}>SCIM base URL</span>
        <input readOnly value={baseUrl} onFocus={(e) => e.currentTarget.select()} style={codeStyle} />
      </label>

      {token && (
        <div
          style={{
            display: "grid",
            gap: 6,
            border: "1px solid color-mix(in srgb, var(--warn) 45%, transparent)",
            background: "color-mix(in srgb, var(--warn) 8%, transparent)",
            borderRadius: 8,
            padding: 10,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600 }}>
            Copy this bearer token now — it won&rsquo;t be shown again.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <input readOnly value={token} onFocus={(e) => e.currentTarget.select()} style={codeStyle} />
            <button type="button" onClick={() => copy(token)} style={btn("secondary")}>
              Copy
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={rotate} disabled={busy} style={btn("primary")}>
          {on ? "Rotate token" : "Generate token & enable"}
        </button>
        {on && (
          <button type="button" onClick={disable} disabled={busy} style={btn("danger")}>
            Disable
          </button>
        )}
      </div>
    </div>
  );
}
