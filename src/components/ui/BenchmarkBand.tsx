import type { CSSProperties, ReactNode } from "react";
import { TONE_VAR, type Tone } from "@/components/ui/Badge";
import { BAND_LABELS, ordinal, type Band, type Position } from "@/domain/benchmarks/percentiles";

/**
 * Inline "vs peers" chip — where a metric falls within its anonymized peer cohort
 * (Bet B, the NET-axis moat: ACE is single-account and can never show this). Muted
 * by design so it annotates a headline number without competing with it. The tone
 * scans green -> blue -> amber -> red from top quartile down.
 */

const BAND_TONE: Record<Band, Tone> = {
  top_quartile: "ok",
  above_median: "info",
  below_median: "warn",
  bottom_quartile: "danger",
};

function chipStyle(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    borderRadius: 999,
    padding: "1px 8px",
    lineHeight: 1.6,
    whiteSpace: "nowrap",
  };
}

export function BenchmarkBand({
  position,
  prefix = "vs peers",
  showPercentile = true,
}: {
  position: Position;
  /** Leading label; pass "" to omit. */
  prefix?: string;
  showPercentile?: boolean;
}): ReactNode {
  const color = TONE_VAR[BAND_TONE[position.band]];
  return (
    <span style={chipStyle(color)} title={`${ordinal(position.percentile)} percentile vs your peer cohort`}>
      {prefix ? <span style={{ opacity: 0.75, fontWeight: 500 }}>{prefix}</span> : null}
      {showPercentile ? <span>{ordinal(position.percentile)}</span> : null}
      <span>{BAND_LABELS[position.band]}</span>
    </span>
  );
}
