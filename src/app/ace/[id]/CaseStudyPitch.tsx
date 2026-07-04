"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import {
  generateCaseStudyPitchAction,
  type CaseStudyPitchState,
} from "@/domain/ace/case-study-pitch-actions";

const INITIAL: CaseStudyPitchState = { ok: false };

/**
 * Optional "Why these fit" island for the Deal Desk case-study panel. Submits only
 * the opportunity id; the gated server action re-derives the matches under RLS and
 * asks Claude for one seller-ready line per study. Disabled with a hint when
 * ANTHROPIC_API_KEY isn't configured — the deterministic matching works without it.
 */
export function CaseStudyPitch({ enabled, oppId }: { enabled: boolean; oppId: string }): ReactNode {
  const [state, action, pending] = useActionState(generateCaseStudyPitchAction, INITIAL);
  const busy = !enabled || pending;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <form action={action} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="opportunityId" value={oppId} />
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
          {pending ? "Thinking…" : "Why these fit"}
        </button>
        {!enabled && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Set <code>ANTHROPIC_API_KEY</code> to enable.
          </span>
        )}
      </form>

      {state.error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{state.error}</p>}

      {state.ok && state.pitches && (
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
          {state.pitches.map((p) => (
            <span key={p.caseStudyId} style={{ color: "var(--muted)" }}>
              <strong style={{ color: "var(--text)" }}>{p.title}</strong> — {p.why}
            </span>
          ))}
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            AI talking points grounded on the matched studies — verify before you quote.
          </span>
        </div>
      )}
    </div>
  );
}
