"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import {
  generateAttributionAdviceAction,
  type AttributionAdviceState,
} from "@/domain/marketplace/attribution-ai-actions";

const INITIAL: AttributionAdviceState = { ok: false };

/**
 * Optional AI read-out for the attribution advisor. The deterministic findings
 * render server-side regardless; this island asks Claude to rewrite the COMPUTED
 * insights into a prioritized read-out. The server action re-derives everything
 * under RLS — nothing from this client is trusted. Mirrors WinLossNarrative.
 */
export function AttributionAdvisor({ enabled }: { enabled: boolean }): ReactNode {
  const [state, action, pending] = useActionState(generateAttributionAdviceAction, INITIAL);
  const busy = !enabled || pending;

  return (
    <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <form action={action} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="submit"
          disabled={busy}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "7px 14px",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: 13,
            fontFamily: "inherit",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: enabled ? 1 : 0.6,
          }}
        >
          {pending ? "Analyzing…" : "Ask AI for a read-out"}
        </button>
        {!enabled && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Set <code>ANTHROPIC_API_KEY</code> to enable.
          </span>
        )}
      </form>

      {state.error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>{state.error}</p>}

      {state.ok && state.advice && (
        <div
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          <strong style={{ fontSize: 14, lineHeight: 1.5 }}>{state.advice.headline}</strong>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            {state.advice.advice.map((a, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                {a}
              </li>
            ))}
          </ol>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            AI read-out of the computed findings — advisory, verify before acting.
          </span>
        </div>
      )}
    </div>
  );
}
