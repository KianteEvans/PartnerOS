"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { askAwsAction, type AskAwsState } from "@/domain/aws-knowledge/actions";

const INITIAL: AskAwsState = { ok: false };

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

/**
 * "Ask AWS" — a doc-grounded Q&A island. Submits to the askAwsAction server action,
 * which calls Claude with the AWS Knowledge MCP connector and returns a cited answer.
 * Disabled (with a hint) when ANTHROPIC_API_KEY isn't configured.
 */
export function AskAws({ enabled }: { enabled: boolean }): ReactNode {
  const [state, action, pending] = useActionState(askAwsAction, INITIAL);
  const busy = !enabled || pending;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
        Ask about AWS partner-program requirements — answers are grounded in live AWS
        documentation, with sources.
      </p>

      <form action={action} style={{ display: "grid", gap: 8 }}>
        <textarea
          name="question"
          rows={2}
          maxLength={1000}
          required
          disabled={busy}
          placeholder="e.g. What evidence does the AWS Migration Competency require?"
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
            {pending ? "Asking AWS…" : "Ask AWS"}
          </button>
          {!enabled && (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Set <code>ANTHROPIC_API_KEY</code> to enable.
            </span>
          )}
        </div>
      </form>

      {state.error && (
        <p style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>{state.error}</p>
      )}

      {state.ok && state.answer && (
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
            {state.answer}
          </div>

          {state.citations && state.citations.length > 0 && (
            <div style={{ display: "grid", gap: 4, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                AWS sources
              </span>
              {state.citations.map((c) => (
                <a
                  key={c.url}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none", overflowWrap: "anywhere" }}
                >
                  {c.url}
                </a>
              ))}
            </div>
          )}

          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            Grounded in AWS documentation
            {typeof state.toolCalls === "number" && state.toolCalls > 0
              ? ` · ${state.toolCalls} lookup${state.toolCalls === 1 ? "" : "s"}`
              : ""}
            . Verify against the linked sources.
          </span>
        </div>
      )}
    </div>
  );
}
