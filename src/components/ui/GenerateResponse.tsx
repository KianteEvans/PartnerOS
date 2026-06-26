"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  generateControlResponseAction,
  type GenerateControlState,
} from "@/domain/applications/generate-actions";

const INITIAL: GenerateControlState = { ok: false };

function tone(c: number): string {
  return c >= 70 ? "var(--ok)" : c >= 40 ? "var(--warn)" : "var(--danger)";
}

/**
 * Per-control "Generate response" island. Calls the gated AI action, which drafts
 * + persists the response; on success we refresh so the review field + badges
 * pick up the saved draft. Disabled (with a hint) when ANTHROPIC_API_KEY is unset.
 */
export function GenerateResponse({
  controlId,
  enabled,
  label = "Generate response",
}: {
  controlId: string;
  enabled: boolean;
  label?: string;
}): ReactNode {
  const router = useRouter();
  const [state, action, pending] = useActionState(generateControlResponseAction, INITIAL);
  const busy = !enabled || pending;

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <form action={action} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="controlId" value={controlId} />
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
          {pending ? "Drafting…" : label}
        </button>
        {!enabled && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Set <code>ANTHROPIC_API_KEY</code> to enable.
          </span>
        )}
      </form>

      {state.error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{state.error}</p>}

      {state.ok && typeof state.confidence === "number" && (
        <div
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            display: "grid",
            gap: 4,
          }}
        >
          <strong style={{ color: tone(state.confidence) }}>
            Draft saved · {state.confidence}% confidence · Met: {state.met}
          </strong>
          <span style={{ color: "var(--muted)", whiteSpace: "pre-wrap" }}>{state.response}</span>
          {state.reasoning && (
            <span style={{ color: "var(--muted)", fontSize: 11 }}>{state.reasoning}</span>
          )}
        </div>
      )}
    </div>
  );
}
