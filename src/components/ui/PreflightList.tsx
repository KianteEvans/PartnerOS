import type { ReactNode } from "react";
import { RingGauge } from "@/components/ui/RingGauge";
import { Callout } from "@/components/ui/Callout";

/**
 * Pass/fail checklist — unifies the three drifting inline preflight renderers
 * (reports "Approval preflight", mdf "Eligibility preflight", settings
 * "Workspace readiness"). The `critical` flag drives fail severity so each site
 * keeps its intended signal: pass -> green check; a failing critical check ->
 * red cross; a failing non-critical check -> muted circle ("not yet, not blocking").
 * `summary` adds a RingGauge + ready/blocked line; `nextStep` adds a Callout
 * pointing at the first unmet control. Presentational + sync.
 */
export function PreflightList({
  checks,
  summary,
  nextStep,
}: {
  checks: ReadonlyArray<{ label: string; ok: boolean; critical?: boolean }>;
  summary?: { percent: number; ready: boolean; readyText: string; blockedText: string };
  nextStep?: { title: string; label: string; href: string };
}): ReactNode {
  return (
    <>
      {summary ? (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <RingGauge value={summary.percent} color={summary.ready ? "var(--ok)" : "var(--warn)"} caption="ready" size={104} />
          <p style={{ color: summary.ready ? "var(--ok)" : "var(--warn)", fontSize: 13, margin: 0, fontWeight: 600, minWidth: 180, flex: 1 }}>
            {summary.ready ? summary.readyText : summary.blockedText}
          </p>
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 4 }}>
        {checks.map((c) => {
          const glyph = c.ok ? "✓" : c.critical ? "✗" : "○";
          const color = c.ok ? "var(--ok)" : c.critical ? "var(--danger)" : "var(--muted)";
          return (
            <div key={c.label} style={{ fontSize: 13 }}>
              <span style={{ color, fontWeight: 700 }}>{glyph}</span> {c.label}
              {c.critical ? <span style={{ color: "var(--muted)", fontSize: 11 }}> · critical</span> : null}
            </div>
          );
        })}
      </div>
      {nextStep ? (
        <div style={{ marginTop: 14 }}>
          <Callout tone="info" title={nextStep.title}>
            {nextStep.label} isn&apos;t set yet.{" "}
            <a href={nextStep.href} style={{ color: "var(--accent)", fontWeight: 600 }}>Configure →</a>
          </Callout>
        </div>
      ) : null}
    </>
  );
}
