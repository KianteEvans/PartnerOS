import type { CSSProperties, ReactNode } from "react";
import { lifecycleSteps, type MdfStatus, type StepState } from "@/domain/mdf/lifecycle";

/**
 * Horizontal funding-stage stepper for the MDF detail page. Pure presentation over
 * the pure `lifecycleSteps(status)` — done stages are checked + section-accent
 * filled, the current stage is haloed, upcoming stages are muted, and a rejected
 * request short-circuits to a distinct red terminal chip. Server-rendered, no JS.
 */

const SECTION = "var(--section-accent)";
const DOT = 26;

function dotStyle(state: StepState): CSSProperties {
  const base: CSSProperties = {
    width: DOT,
    height: DOT,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  };
  switch (state) {
    case "done":
      return { ...base, background: SECTION, color: "var(--accent-ink)" };
    case "current":
      return {
        ...base,
        background: SECTION,
        color: "var(--accent-ink)",
        boxShadow: `0 0 0 4px color-mix(in srgb, ${SECTION} 24%, transparent)`,
      };
    case "rejected":
      return { ...base, background: "var(--danger)", color: "#fff" };
    case "upcoming":
    default:
      return { ...base, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" };
  }
}

function labelColor(state: StepState): string {
  if (state === "rejected") return "var(--danger)";
  if (state === "upcoming") return "var(--muted)";
  return "var(--text)";
}

export function MdfLifecycleStepper({ status }: { status: MdfStatus }): ReactNode {
  const steps = lifecycleSteps(status);
  return (
    <ol
      style={{
        display: "flex",
        listStyle: "none",
        margin: 0,
        padding: 0,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const glyph = s.state === "done" ? "✓" : s.state === "rejected" ? "✕" : String(i + 1);
        return (
          <li
            key={s.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              flex: last ? "0 1 auto" : "1 1 auto",
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 72 }}>
              <span style={dotStyle(s.state)}>{glyph}</span>
              <span style={{ fontSize: 12, color: labelColor(s.state), fontWeight: s.state === "current" ? 600 : 400, textAlign: "center" }}>
                {s.label}
              </span>
            </div>
            {!last ? (
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  minWidth: 16,
                  height: 2,
                  marginTop: DOT / 2 - 1,
                  background: s.state === "done" ? SECTION : "var(--border)",
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
