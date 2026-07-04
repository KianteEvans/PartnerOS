import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Callout } from "@/components/ui/Callout";
import { BenchmarkBand } from "@/components/ui/BenchmarkBand";
import { formatMetric } from "@/domain/benchmarks/percentiles";
import type { BenchmarkView, MetricPosition } from "@/domain/benchmarks/load";

/**
 * The dedicated Benchmarks panel (Bet B). For a participant it shows every metric
 * vs the anonymized TIER cohort (primary) with a TENURE read-out (secondary):
 * your value, the peer median, and where you land. For a non-participant it shows
 * only the reciprocal opt-in CTA — never peer numbers. This is the NET-axis moat:
 * an honest "no" to "could ACE show this?" (ACE is one account by construction).
 */

const muted = { color: "var(--muted)", fontSize: 12 } as const;

function ValueCell({ p }: { p: MetricPosition }): ReactNode {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
      {p.value == null ? <span style={muted}>n/a</span> : formatMetric(p.format, p.value)}
    </span>
  );
}

function PeerCell({ p }: { p: MetricPosition }): ReactNode {
  if (p.cohortMedian == null) return <span style={muted}>—</span>;
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatMetric(p.format, p.cohortMedian)}
      <span style={{ ...muted, marginLeft: 6 }}>n={p.sampleCount}</span>
    </span>
  );
}

export function BenchmarksPanel({ view }: { view: BenchmarkView }): ReactNode {
  if (!view.participating) {
    return (
      <Panel title="Benchmarks" accent="info">
        <Callout tone="info" title="See how you compare to partners like you">
          Opt in to contribute your anonymized metrics and unlock peer benchmarks — partnership
          health, tier progress, win rate and more, versus a cohort of partners at your tier and
          tenure. It is reciprocal (you see peers only while you contribute) and every cohort is
          anonymized across at least 5 partners.{" "}
          <Link href="/settings" style={{ color: "var(--accent)", fontWeight: 600 }}>
            Turn on benchmarking in Settings →
          </Link>
        </Callout>
      </Panel>
    );
  }

  const tenureByKey = new Map(view.tenure.positions.map((p) => [p.key, p]));
  const anyData = view.tier.hasData || view.tenure.hasData;

  return (
    <Panel
      title="Benchmarks"
      accent="info"
      actions={
        <span style={muted}>
          vs {view.tier.label} partners · {view.tenure.label}
        </span>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        {!anyData ? (
          <Callout tone="neutral" title="Peer cohorts are still forming">
            Benchmarks appear once at least 5 opted-in partners share your cohort. Your own metrics
            are shown below in the meantime.
          </Callout>
        ) : null}

        <div style={{ display: "grid", gap: 2 }}>
          {/* header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 0.8fr 1fr auto",
              gap: 10,
              padding: "0 2px 6px",
              borderBottom: "1px solid var(--border)",
              ...muted,
              fontWeight: 600,
            }}
          >
            <span>Metric</span>
            <span>You</span>
            <span>Peer median</span>
            <span style={{ textAlign: "right" }}>Standing</span>
          </div>

          {view.tier.positions.map((p) => {
            const tenurePos = tenureByKey.get(p.key);
            return (
              <div
                key={p.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 0.8fr 1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "8px 2px",
                  borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
                }}
              >
                <span style={{ fontSize: 13 }} title={p.hint}>
                  {p.label}
                </span>
                <ValueCell p={p} />
                <PeerCell p={p} />
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 3,
                  }}
                >
                  {p.position ? (
                    <BenchmarkBand position={p.position} prefix="" />
                  ) : (
                    <span style={muted}>—</span>
                  )}
                  {tenurePos?.position ? (
                    <span style={{ ...muted, fontSize: 10.5 }}>
                      {view.tenure.label}: {tenurePos.position.band.replace(/_/g, " ")}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>

        <p style={{ ...muted, margin: 0 }}>
          {view.capturedOn
            ? `Cohort data as of ${view.capturedOn} · anonymized across ≥5 partners · higher is better.`
            : "Anonymized peer cohorts · min 5 partners · higher is better."}
        </p>
      </div>
    </Panel>
  );
}
