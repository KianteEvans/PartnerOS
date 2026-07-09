"use client";

import { useEffect } from "react";
import type { ReactNode, CSSProperties } from "react";
import Link from "next/link";

/**
 * Route-segment error boundary. Next renders this — INSIDE the root layout, so
 * the sidebar/top bar stay put — whenever a Server Component throws below it.
 * Client component by contract (it needs `reset`).
 *
 * We show a calm, branded recovery screen with a retry, never a raw stack trace
 * (that would leak internals to a customer). `error.digest` is a stable,
 * non-sensitive id that Next also logs server-side, so an operator can correlate
 * what the user saw with the full error in the logs.
 */

const primaryBtn: CSSProperties = {
  appearance: "none",
  border: "1px solid transparent",
  borderRadius: 999,
  padding: "8px 18px",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--accent)",
  color: "var(--accent-ink)",
};

const secondaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "8px 18px",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  textDecoration: "none",
  color: "var(--text)",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
};

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  useEffect(() => {
    // Server-side capture happens globally in src/instrumentation.ts
    // (onRequestError) as a structured JSON line keyed by the same digest shown
    // below -- this client log is just the local echo in the browser console.
    console.error("Route error boundary:", error);
  }, [error]);

  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "48px 24px" }}>
      <div
        role="alert"
        style={{
          maxWidth: 460,
          width: "100%",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "var(--shadow)",
          padding: 28,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb, var(--accent) 14%, transparent)",
              color: "var(--accent)",
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            !
          </span>
          <h1 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text)" }}>
            Something went wrong
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--muted)", lineHeight: 1.55 }}>
          This page hit an unexpected error. Your data is safe — you can retry, or head back to your
          workspace home.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" onClick={() => reset()} style={primaryBtn}>
            Try again
          </button>
          <Link href="/" style={secondaryBtn}>
            Back to home
          </Link>
        </div>
        {error.digest ? (
          <code style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            Reference: {error.digest}
          </code>
        ) : null}
      </div>
    </div>
  );
}
