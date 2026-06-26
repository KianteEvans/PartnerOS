"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import {
  recommendNarrativeAction,
  type RecommendNarrativeState,
} from "@/domain/programs/recommend-actions";

const INITIAL: RecommendNarrativeState = { ok: false };

/**
 * Optional "Summarize with AI" island for the Recommended view. Submits to
 * recommendNarrativeAction, which re-derives the top recommendations server-side and
 * asks Claude for a short "why this competency next" rationale. Disabled (with a hint)
 * when ANTHROPIC_API_KEY isn't configured — the deterministic ranking works without it.
 */
export function RecommendNarrative({ enabled }: { enabled: boolean }): ReactNode {
  const [state, action, pending] = useActionState(recommendNarrativeAction, INITIAL);
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
          {pending ? "Summarizing…" : "Summarize with AI"}
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
          {state.topPick && <strong style={{ color: "var(--ok)" }}>Next: {state.topPick}</strong>}
          <span style={{ color: "var(--muted)" }}>{state.narrative}</span>
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            AI estimate — verify against AWS&apos;s actual requirements.
          </span>
        </div>
      )}
    </div>
  );
}
