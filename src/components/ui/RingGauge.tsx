import type { CSSProperties, ReactNode } from "react";

/**
 * Dependency-free donut gauge — a single value as a filled arc over a track ring,
 * with the value (and an optional caption) centered inside. Pure SVG, themed via
 * CSS variables, so it renders on the server with no client JS.
 *
 * The arc starts at 12 o'clock and sweeps clockwise to `value / max`.
 */
export function RingGauge({
  value,
  max = 100,
  size = 120,
  thickness = 12,
  color = "var(--accent-2)",
  label,
  caption,
}: {
  value: number;
  max?: number;
  /** Outer pixel diameter. */
  size?: number;
  /** Ring stroke width. */
  thickness?: number;
  // `| undefined` (not just `?`) so callers can forward an index-typed or
  // optional value under exactOptionalPropertyTypes; the default still applies.
  /** Arc color (a CSS var or literal). */
  color?: string | undefined;
  /** Big center text; defaults to the rounded value. */
  label?: string | undefined;
  /** Small text under the value (e.g. a band name). */
  caption?: string | undefined;
}): ReactNode {
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const dash = pct * circumference;
  const center = size / 2;
  const display = label ?? String(Math.round(value));
  // Derive a stable gradient id from the colour itself: equal colours share an
  // (identical) gradient, different colours get distinct ids -> no SVG def clash.
  const gid = `rg-${String(color).replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${display}${caption ? ` (${caption})` : ""} of ${max}`}
    >
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: color }} />
          <stop offset="100%" style={{ stopColor: `color-mix(in srgb, ${color} 55%, #fff)` }} />
        </linearGradient>
      </defs>
      <circle cx={center} cy={center} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - dash}
        transform={`rotate(-90 ${center} ${center})`}
        className="pos-ring-arc"
        style={{ "--ring-circ": circumference } as CSSProperties}
      />
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        dy={caption ? -6 : 0}
        style={{ fontSize: size * 0.26, fontWeight: 700, fill: color }}
      >
        {display}
      </text>
      {caption && (
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          dy={size * 0.16}
          style={{ fontSize: size * 0.1, fill: "var(--muted)", textTransform: "capitalize" }}
        >
          {caption}
        </text>
      )}
    </svg>
  );
}
