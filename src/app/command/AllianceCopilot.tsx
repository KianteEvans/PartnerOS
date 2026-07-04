"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { askAllianceCopilot, type CopilotState } from "@/domain/copilot/actions";

const INITIAL: CopilotState = { ok: false, turns: [] };

const control = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
  resize: "vertical",
} as const;

const chipStyle = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "4px 12px",
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "left",
} as const;

/**
 * Alliance Copilot — a conversational strategy island grounded in the LIVE workspace.
 * The transcript lives HERE (client state) and is resent with each question as a JSON
 * field; the askAllianceCopilot server action treats it as conversational context only
 * and recompiles a fresh deterministic brief server-side under RLS on every turn
 * (health, decision queue, next-best-actions, tier ETA, progress). Suggested next steps
 * double as one-click follow-up chips. Disabled (with a hint) when ANTHROPIC_API_KEY
 * isn't configured — the honest dev state.
 */
export function AllianceCopilot({
  enabled,
  targetTierLabel,
}: {
  enabled: boolean;
  targetTierLabel: string;
}): ReactNode {
  const [state, action, pending] = useActionState(askAllianceCopilot, INITIAL);
  const busy = !enabled || pending;
  const suggestion = `What should we prioritize this quarter to reach ${targetTierLabel}?`;
  const hasTurns = state.turns.length > 0;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
        Ask a strategic question about this partnership — then follow up. The copilot answers
        from your live workspace — health and its drivers, the decision queue, the
        highest-leverage moves, and your tier path — re-grounded on the latest numbers every
        turn.
      </p>

      <form action={action} style={{ display: "grid", gap: 12 }}>
        <input type="hidden" name="history" value={JSON.stringify(state.turns)} readOnly />

        {hasTurns && (
          <div style={{ display: "grid", gap: 12 }}>
            {state.truncated && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                Older turns were dropped from the copilot&apos;s context.
              </span>
            )}
            {state.turns.map((t, i) => {
              const last = i === state.turns.length - 1;
              return (
                <div key={i} style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>You · </span>
                    {t.q}
                  </div>
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
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: "var(--text)" }}>
                      {t.a}
                    </div>

                    {last && state.reasoning && (
                      <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic", lineHeight: 1.5 }}>
                        {state.reasoning}
                      </div>
                    )}

                    {last && state.nextActions && state.nextActions.length > 0 && (
                      <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                        <span
                          style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}
                        >
                          Suggested next steps — click to ask how
                        </span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {state.nextActions.map((a, j) => (
                            <button
                              key={j}
                              type="submit"
                              name="chip"
                              value={`How should we execute: "${a}"?`}
                              formNoValidate
                              disabled={busy}
                              style={{ ...chipStyle, cursor: busy ? "not-allowed" : "pointer" }}
                            >
                              {a}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Grounded in your live workspace. Advisory — verify before acting.
            </span>
          </div>
        )}

        {state.error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>{state.error}</p>}

        <textarea
          key={`turn-${state.turns.length}`}
          name="question"
          rows={2}
          minLength={10}
          maxLength={2000}
          required
          disabled={busy}
          defaultValue={hasTurns ? "" : suggestion}
          placeholder={hasTurns ? "Ask a follow-up…" : suggestion}
          style={control}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: "var(--accent)",
              color: "var(--accent-ink)",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: enabled ? 1 : 0.6,
            }}
          >
            {pending ? "Thinking…" : hasTurns ? "Ask follow-up" : "Ask the copilot"}
          </button>
          {hasTurns && (
            <button
              type="submit"
              name="reset"
              value="1"
              formNoValidate
              disabled={pending}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 14px",
                color: "var(--muted)",
                fontWeight: 600,
                fontSize: 13,
                fontFamily: "inherit",
                cursor: pending ? "not-allowed" : "pointer",
              }}
            >
              New conversation
            </button>
          )}
          {!enabled && (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Set <code>ANTHROPIC_API_KEY</code> to enable.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
