import type { CSSProperties, ReactNode } from "react";
import type { LadderStep, LadderStatus } from "@/domain/tiers/ladder";

/**
 * The partner-tier journey as a horizontal stepper: registered -> select ->
 * advanced -> premier, with achieved tiers behind you, your current tier marked,
 * and the target highlighted with its readiness. Pure server-rendered divs (no
 * client JS), responsive via flex-wrap. Models the SectionTabs / progress-track look.
 */

const DOT: Record<LadderStatus, { bg: string; border: string; ink: string; glyph: string }> = {
  achieved: { bg: "var(--ok)", border: "var(--ok)", ink: "#fff", glyph: "✓" },
  current: { bg: "var(--accent)", border: "var(--accent)", ink: "var(--accent-ink)", glyph: "●" },
  upcoming: { bg: "var(--panel)", border: "var(--accent-2)", ink: "var(--accent-2)", glyph: "" },
  target: { bg: "var(--accent-2)", border: "var(--accent-2)", ink: "#fff", glyph: "★" },
  locked: { bg: "var(--panel-2)", border: "var(--border)", ink: "var(--muted)", glyph: "🔒" },
};

/** Color of the track segment that ENDS at step index `k` (the path into it). */
function segColor(k: number, currentIdx: number, targetIdx: number): string {
  if (k <= currentIdx) return "var(--ok)"; // travelled
  if (targetIdx > currentIdx && k <= targetIdx) return "var(--accent-2)"; // planned path
  return "var(--border)";
}

export function TierLadder({
  steps,
  readinessPercent,
}: {
  steps: readonly LadderStep[];
  readinessPercent?: number | undefined;
}): ReactNode {
  const last = steps.length - 1;
  const currentIdx = steps.findIndex((s) => s.status === "current");
  const targetIdx = steps.findIndex((s) => s.status === "target");

  const line = (color: string): CSSProperties => ({
    flex: 1,
    height: 3,
    borderRadius: 999,
    background: color,
    minWidth: 8,
  });

  return (
    <nav
      aria-label="Partner tier ladder"
      style={{
        display: "flex",
        gap: 4,
        padding: "16px 12px",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        flexWrap: "wrap",
      }}
    >
      {steps.map((s, i) => {
        const d = DOT[s.status];
        const isTarget = s.status === "target";
        const emphasize = s.status === "current" || isTarget;
        const caption =
          isTarget && readinessPercent !== undefined
            ? `${readinessPercent}% ready`
            : s.reqCount > 0
              ? `${s.reqCount} req${s.reqCount === 1 ? "" : "s"}`
              : "entry";
        return (
          <div key={s.tier} style={{ flex: "1 1 0", minWidth: 96, display: "grid", gap: 6, justifyItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              <div style={line(i === 0 ? "transparent" : segColor(i, currentIdx, targetIdx))} />
              <div
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                  fontWeight: 700,
                  background: d.bg,
                  color: d.ink,
                  border: `2px solid ${d.border}`,
                  boxShadow: emphasize ? "var(--shadow-sm)" : "none",
                  margin: "0 4px",
                }}
              >
                {d.glyph}
              </div>
              <div style={line(i === last ? "transparent" : segColor(i + 1, currentIdx, targetIdx))} />
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: emphasize ? 700 : 500,
                color: s.status === "locked" ? "var(--muted)" : "var(--text)",
              }}
            >
              {s.label}
            </span>
            <span style={{ fontSize: 11, color: isTarget ? "var(--accent-2)" : "var(--muted)", fontWeight: isTarget ? 600 : 400 }}>
              {s.status === "current" ? "You are here" : caption}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
