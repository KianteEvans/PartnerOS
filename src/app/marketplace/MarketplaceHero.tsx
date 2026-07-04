import type { ReactNode } from "react";
import { RingGauge } from "@/components/ui/RingGauge";
import { DeltaChip } from "@/components/ui/DeltaChip";
import { MetricCard, type MetricTrend } from "@/components/ui/MetricCard";
import type { Tone } from "@/components/ui/Badge";
import { trendDelta } from "@/domain/trend";

/**
 * The accent-tinted Marketplace section hero: a RingGauge (a key ratio) on the left and a
 * strip of trend-bearing KPI cards on the right, on the `--surface-hero` gradient (auto-
 * fuchsia via `data-section="marketplace"`). Mirrors the home-hub / MDF hero so every tab
 * opens with the same premium band.
 */

export interface HeroCard {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: Tone;
  readonly tint?: Tone;
  /** Daily series for the sparkline + delta (>=2 points to render). */
  readonly trend?: readonly number[];
  readonly trendInvert?: boolean;
  readonly trendSuffix?: string;
}

function mkTrend(card: HeroCard): MetricTrend | undefined {
  if (!card.trend || card.trend.length < 2) return undefined;
  const values = [...card.trend];
  return {
    values,
    delta: trendDelta(values),
    ...(card.trendInvert ? { invert: true } : {}),
    ...(card.trendSuffix ? { deltaSuffix: card.trendSuffix } : {}),
  };
}

export function MarketplaceHero({
  ring,
  ringDelta,
  ringDeltaSuffix,
  cards,
}: {
  readonly ring: { value: number; max?: number; caption: string; color?: string };
  readonly ringDelta?: number | null;
  readonly ringDeltaSuffix?: string;
  readonly cards: readonly HeroCard[];
}): ReactNode {
  return (
    <section
      style={{
        display: "flex",
        gap: 20,
        flexWrap: "wrap",
        alignItems: "center",
        background: "var(--surface-hero)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
        boxShadow: "var(--shadow-md)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 144 }}>
        <RingGauge
          value={ring.value}
          max={ring.max ?? 100}
          color={ring.color ?? "var(--section-accent)"}
          caption={ring.caption}
          size={120}
        />
        {ringDelta != null ? <DeltaChip delta={ringDelta} suffix={ringDeltaSuffix ?? ""} /> : null}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 244,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
        }}
      >
        {cards.map((c) => (
          <MetricCard
            key={c.label}
            label={c.label}
            value={c.value}
            {...(c.sub ? { sub: c.sub } : {})}
            {...(c.tone ? { tone: c.tone } : {})}
            {...(c.tint ? { tint: c.tint } : {})}
            {...(mkTrend(c) ? { trend: mkTrend(c)! } : {})}
          />
        ))}
      </div>
    </section>
  );
}
