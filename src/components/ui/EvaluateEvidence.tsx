"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import {
  evaluateEvidenceAction,
  type EvaluateEvidenceState,
} from "@/domain/evidence/evaluate-actions";

const INITIAL: EvaluateEvidenceState = { ok: false };

function tone(confidence: number): string {
  return confidence >= 70 ? "var(--ok)" : confidence >= 40 ? "var(--warn)" : "var(--danger)";
}

/**
 * Optional "Evaluate with AI" island for a program requirement that has linked
 * evidence. Submits to evaluateEvidenceAction, which asks Claude whether the linked
 * artifact plausibly satisfies the requirement and returns a confidence + reasoning.
 * Disabled (with a hint) when ANTHROPIC_API_KEY isn't configured — the deterministic
 * fit engine works without it.
 */
export function EvaluateEvidence({
  evidenceId,
  requirementId,
  enabled,
}: {
  evidenceId: string;
  requirementId: string;
  enabled: boolean;
}): ReactNode {
  const [state, action, pending] = useActionState(evaluateEvidenceAction, INITIAL);
  const busy = !enabled || pending;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <form action={action} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="evidenceId" value={evidenceId} />
        <input type="hidden" name="requirementId" value={requirementId} />
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
          {pending ? "Evaluating…" : "Evaluate with AI"}
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
            lineHeight: 1.5,
            display: "grid",
            gap: 4,
          }}
        >
          <strong style={{ color: tone(state.confidence) }}>
            {state.confidence}% confidence this evidence satisfies the requirement
          </strong>
          <span style={{ color: "var(--muted)" }}>{state.reasoning}</span>
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            AI estimate — verify against AWS's actual requirements.
          </span>
        </div>
      )}
    </div>
  );
}
