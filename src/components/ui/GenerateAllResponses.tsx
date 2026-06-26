"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { generateControlResponseAction } from "@/domain/applications/generate-actions";

/**
 * "Generate all" runs the gated AI action over each draftable control one at a
 * time (client-side loop) — a workbook is ~40-60 controls against a 10/60s
 * limiter, so a server fan-out would 429. Shows progress and backs off when the
 * limiter says to. Refreshes once at the end so the saved drafts render.
 */
export function GenerateAllResponses({
  controlIds,
  enabled,
}: {
  controlIds: readonly string[];
  enabled: boolean;
}): ReactNode {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const total = controlIds.length;

  async function run(): Promise<void> {
    setRunning(true);
    setError(null);
    setDone(0);
    for (let i = 0; i < controlIds.length; i += 1) {
      const fd = new FormData();
      fd.set("controlId", controlIds[i]!);
      let res = await generateControlResponseAction({ ok: false }, fd);
      let attempts = 0;
      while (res.error && /try again in (\d+)s/.test(res.error) && attempts < 4) {
        const m = /try again in (\d+)s/.exec(res.error);
        const wait = m && m[1] ? Math.min(30, Number(m[1])) : 5;
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        res = await generateControlResponseAction({ ok: false }, fd);
        attempts += 1;
      }
      if (!res.ok) {
        setError(res.error ?? "Generation stopped.");
        break;
      }
      setDone(i + 1);
    }
    setRunning(false);
    router.refresh();
  }

  if (total === 0) return null;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        onClick={run}
        disabled={!enabled || running}
        style={{
          background: "var(--accent)",
          color: "var(--accent-ink)",
          border: "none",
          borderRadius: 8,
          padding: "8px 16px",
          fontWeight: 600,
          fontSize: 13,
          cursor: !enabled || running ? "not-allowed" : "pointer",
          opacity: enabled ? 1 : 0.6,
          justifySelf: "start",
        }}
      >
        {running ? `Drafting ${done}/${total}…` : `Generate all responses (${total})`}
      </button>
      {!enabled && (
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Set <code>ANTHROPIC_API_KEY</code> to enable AI drafting.
        </span>
      )}
      {running && (
        <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.round((done / total) * 100)}%`,
              height: "100%",
              background: "var(--accent)",
              transition: "width 0.2s ease",
            }}
          />
        </div>
      )}
      {error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{error}</p>}
    </div>
  );
}
