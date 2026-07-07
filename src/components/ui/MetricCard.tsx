import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { Tone } from "@/components/ui/Badge";
import { Sparkline } from "@/components/ui/Sparkline";
import { DeltaChip } from "@/components/ui/DeltaChip";
import { CollapsibleCardBody } from "@/components/ui/Collapsible";
import { resolveCollapse } from "@/domain/ui/collapse-server";
import { slugify } from "@/domain/ui/collapse";
import type { MetricTrend } from "@/domain/trend";

// The trend shape lives in the pure domain layer (built by `mkTrend`); re-exported
// here so the many existing `import { ..., type MetricTrend } from MetricCard` sites
// keep working.
export type { MetricTrend };

/**
 * Headline KPI tile — lifted from the ACE dashboard into a shared primitive so
 * every dashboard surfaces metrics identically. `tone` colors the number
 * semantically; `tint` washes the whole card (overdue/positive emphasis); `trend`
 * adds a sparkline + delta chip and replaces `sub` when present. `href` turns the
 * whole card into a drill-through link (rendered non-collapsible — see below).
 * `size="lg"` enlarges the number for a hero metric; `icon` adds a leading glyph.
 * The sparkline + a 2px top-rule take the section accent (`--metric-accent`) so
 * each section's strip reads as its own colour.
 */

const VALUE_COLOR: Record<Tone, string> = {
  neutral: "var(--text)",
  accent: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
};

// ok/danger keep their dedicated surface tokens; the rest derive a matching wash
// via color-mix so any tone can emphasise a KPI card. neutral = no wash.
const TINT: Record<Tone, { bg: string; border: string }> = {
  neutral: { bg: "var(--panel)", border: "var(--border)" },
  accent: { bg: "color-mix(in srgb, var(--accent) 8%, var(--panel))", border: "color-mix(in srgb, var(--accent) 24%, var(--border))" },
  ok: { bg: "var(--surface-tint-ok)", border: "color-mix(in srgb, var(--ok) 22%, var(--border))" },
  warn: { bg: "color-mix(in srgb, var(--warn) 9%, var(--panel))", border: "color-mix(in srgb, var(--warn) 24%, var(--border))" },
  danger: { bg: "var(--surface-tint-danger)", border: "color-mix(in srgb, var(--danger) 22%, var(--border))" },
  info: { bg: "color-mix(in srgb, var(--info) 8%, var(--panel))", border: "color-mix(in srgb, var(--info) 24%, var(--border))" },
};

// 2px section-accent top edge (mirrors Panel's accent border). Set as longhands so
// they win over Card's `border` shorthand + any tint `borderColor`.
const RULE = { borderTopColor: "var(--metric-accent)", borderTopWidth: 2 } as const;

export async function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
  tint,
  trend,
  style,
  href,
  icon,
  size = "md",
  collapsible,
  collapseKey,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  tone?: Tone | undefined;
  tint?: Tone | undefined;
  trend?: MetricTrend | undefined;
  style?: CSSProperties | undefined;
  /** When set, the whole card is a drill-through link (rendered non-collapsible: a <button> can't nest in an <a>). */
  href?: string | undefined;
  /** Optional leading glyph (from icons.tsx), colored with the section accent. */
  icon?: ReactNode | undefined;
  /** "lg" enlarges the value to ~30px for a headline hero metric. */
  size?: "md" | "lg" | undefined;
  /** KPI cards collapse to just their label by default; pass false to opt out. */
  collapsible?: boolean | undefined;
  /** Override the auto-derived (section-scoped) collapse key. */
  collapseKey?: string | undefined;
}): Promise<ReactNode> {
  const tintStyle: CSSProperties | undefined = tint
    ? { background: TINT[tint].bg, borderColor: TINT[tint].border }
    : undefined;
  const sparkColor = tint === "danger" ? "var(--danger)" : "var(--metric-accent)";
  const iconEl = icon ? (
    <span style={{ color: "var(--metric-accent)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
  ) : null;
  const valueRow = (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6, minWidth: 0, overflow: "hidden" }}>
      <div style={{ fontSize: size === "lg" ? 30 : 22, fontWeight: 700, color: VALUE_COLOR[tone], fontVariantNumeric: "tabular-nums", lineHeight: 1.1, flexShrink: 0 }}>
        {value}
      </div>
      {trend ? <Sparkline values={trend.values} color={sparkColor} /> : null}
    </div>
  );
  const labelRow = (
    <div style={{ fontSize: 12.5, color: "var(--text)", marginTop: 4, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      {iconEl}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
  const footer: ReactNode =
    trend && trend.delta !== null ? (
      <div style={{ marginTop: 5 }}>
        <DeltaChip delta={trend.delta} invert={trend.invert} suffix={trend.deltaSuffix} />
      </div>
    ) : sub ? (
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{sub}</div>
    ) : null;

  const body = (
    <>
      {valueRow}
      {labelRow}
      {footer}
    </>
  );

  // A clickable card is a drill-through headline: always expanded (no collapse
  // chevron, which is a <button> and can't nest inside the <a>), with the shared
  // interactive hover-lift.
  if (href) {
    // The <Link> is the grid/flex item, so the caller's `style` (positioning like
    // alignSelf/flex) goes there; the Card keeps the tint wash + accent top-rule.
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit", ...style }}>
        <Card compact interactive style={{ ...tintStyle, ...RULE }}>
          {body}
        </Card>
      </Link>
    );
  }

  if (collapsible === false) {
    return (
      <Card compact style={{ ...tintStyle, ...style, ...RULE }}>
        {body}
      </Card>
    );
  }

  const state = await resolveCollapse(slugify(label), collapseKey);
  return (
    <Card compact style={{ ...tintStyle, ...style, ...RULE }}>
      <CollapsibleCardBody
        collapseKey={state.key}
        initialCollapsed={state.collapsed}
        label={label}
        icon={iconEl}
        above={valueRow}
        below={footer}
      />
    </Card>
  );
}
