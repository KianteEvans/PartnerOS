"use client";

import type { ReactNode } from "react";

/**
 * Last-resort boundary: Next renders this ONLY when the root layout itself
 * throws, so it must supply its own <html>/<body> — the layout (and its
 * globals.css import) may be entirely bypassed. That's why every style here is
 * inline and theme-agnostic (a neutral light palette that also reads fine in a
 * dark browser) rather than relying on CSS variables that might not be loaded.
 *
 * Client component by contract. Kept deliberately minimal and dependency-free
 * so it can render even when much of the app is broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#f5f6f8",
          color: "#1b2026",
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: 440,
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e1e5ea",
            borderRadius: 14,
            boxShadow: "0 1px 2px rgba(16,24,40,0.06), 0 4px 12px rgba(16,24,40,0.08)",
            padding: 28,
            display: "grid",
            gap: 14,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>PartnerOS hit an unexpected error</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#5b6573", lineHeight: 1.55 }}>
            The application couldn&rsquo;t load this page. Please try again. If it keeps happening,
            contact your administrator.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              justifySelf: "start",
              appearance: "none",
              border: "1px solid transparent",
              borderRadius: 999,
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: "#e8590c",
              color: "#ffffff",
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <code style={{ fontSize: 11, color: "#5b6573", fontFamily: "ui-monospace, Menlo, monospace" }}>
              Reference: {error.digest}
            </code>
          ) : null}
        </div>
      </body>
    </html>
  );
}
