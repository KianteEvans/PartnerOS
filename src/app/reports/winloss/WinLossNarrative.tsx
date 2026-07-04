"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import {
  generateWinLossNarrativeAction,
  type WinLossNarrativeState,
} from "@/domain/ace/winloss-ai-actions";

const INITIAL: WinLossNarrativeState = { ok: false };

/**
 * Optional "Explain with AI" island for the win/loss mining page. Submits to the
 * gated server action, which recomputes the report under RLS and asks Claude for a
 * short grounded read-out (aggregates only). Disabled with a hint when
 * ANTHROPIC_API_KEY isn't configured — the deterministic mining works without it.
 */
export function WinLossNarrative({ enabled }: { enabled: boolean }): ReactNode {
  const [state, action, pending] = useActionState(generateWinLossNarrativeAction, INITIAL);
  const busy = !enabled || pending;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <form action={action} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="submit"
          disabled={busy}
          style={{
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "5px 12px",
            fontWeight: 600,
            fontSize: 12,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: enabled ? 1 : 0.6,
          }}
        >
          {pending ? "Analyzing…" : "Explain with AI"}
        </button>
        {!enabled && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Set <code>ANTHROPIC_API_KEY</code> to enable.
          </span>
        )}
      </form>

      {state.error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{state.error}</p>}

      {state.ok && state.narrative && (
        <div
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.5,
            display: "grid",
            gap: 4,
          }}
        >
          <strong style={{ color: "var(--ok)" }}>{state.narrative.headline}</strong>
          {state.narrative.insights.map((i, idx) => (
            <span key={idx} style={{ color: "var(--muted)" }}>
              · {i}
            </span>
          ))}
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            AI read-out of the computed stats — correlation, not causation.
          </span>
        </div>
      )}
    </div>
  );
}
