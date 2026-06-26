import type { CSSProperties, ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import type { Tone } from "@/components/ui/Badge";
import { Sparkline } from "@/components/ui/Sparkline";
import { DeltaChip } from "@/components/ui/DeltaChip";

/**
 * Headline KPI tile — lifted from the ACE dashboard into a shared primitive so
 * every dashboard surfaces metrics identically. `tone` colors the number
 * semantically; `tint` washes the whole card (overdue/positive emphasis); `trend`
 * adds a sparkline + delta chip (Tier 2) and replaces `sub` when present.
 */

const VALUE_COLOR: Record<Tone, string> = {
  neutral: "var(--text)",
  accent: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
};

const TINT: Record<"ok" | "danger", { bg: string; border: string }> = {
  ok: { bg: "var(--surface-tint-ok)", border: "color-mix(in srgb, var(--ok) 22%, var(--border))" },
  danger: { bg: "var(--surface-tint-danger)", border: "color-mix(in srgb, var(--danger) 22%, var(--border))" },
};

export interface MetricTrend {
  readonly values: readonly number[];
  readonly delta: number | null;
  readonly invert?: boolean | undefined;
  readonly deltaSuffix?: string | undefined;
}

export function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
  tint,
  trend,
  style,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  tone?: Tone | undefined;
  tint?: "ok" | "danger" | undefined;
  trend?: MetricTrend | undefined;
  style?: CSSProperties | undefined;
}): ReactNode {
  const tintStyle: CSSProperties | undefined = tint
    ? { background: TINT[tint].bg, borderColor: TINT[tint].border }
    : undefined;
  const sparkColor = tint === "danger" ? "var(--danger)" : "var(--accent-2)";
  return (
    <Card compact style={{ ...tintStyle, ...style }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: VALUE_COLOR[tone], fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {value}
        </div>
        {trend ? <Sparkline values={trend.values} color={sparkColor} /> : null}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text)", marginTop: 4 }}>{label}</div>
      {trend && trend.delta !== null ? (
        <div style={{ marginTop: 5 }}>
          <DeltaChip delta={trend.delta} invert={trend.invert} suffix={trend.deltaSuffix} />
        </div>
      ) : sub ? (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{sub}</div>
      ) : null}
    </Card>
  );
}
