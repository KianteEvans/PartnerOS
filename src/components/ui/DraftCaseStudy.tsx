"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { draftCaseStudyAction, type DraftCaseStudyState } from "@/domain/case-studies/generate-actions";

const INITIAL: DraftCaseStudyState = { ok: false };

/**
 * Optional "Draft narrative with AI" island for a case study. Submits to
 * draftCaseStudyAction, which drafts the five aspects from the linked evidence and
 * saves them (the page re-renders with the narrative). Disabled with a hint when
 * ANTHROPIC_API_KEY isn't configured.
 */
export function DraftCaseStudy({
  caseStudyId,
  enabled,
}: {
  caseStudyId: string;
  enabled: boolean;
}): ReactNode {
  const [state, action, pending] = useActionState(draftCaseStudyAction, INITIAL);
  const busy = !enabled || pending;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <form action={action} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="caseStudyId" value={caseStudyId} />
        <button
          type="submit"
          disabled={busy}
          style={{
            background: "transparent",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 14px",
            fontWeight: 600,
            fontSize: 13,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: enabled ? 1 : 0.6,
          }}
        >
          {pending ? "Drafting…" : "Draft narrative with AI"}
        </button>
        {!enabled && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            Set <code>ANTHROPIC_API_KEY</code> to enable.
          </span>
        )}
      </form>
      {state.error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{state.error}</p>}
      {state.ok && (
        <p style={{ margin: 0, color: "var(--ok)", fontSize: 12 }}>
          Draft saved from your evidence — review and edit the narrative below.
        </p>
      )}
    </div>
  );
}
