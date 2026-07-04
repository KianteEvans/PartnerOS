import type { ReactNode } from "react";
import { daysBetween } from "@/domain/dates";
import type { SeriesPoint, BandPoint } from "@/domain/forecast/project";

/**
 * Server-rendered projection chart (no client JS, same idiom as Sparkline): the
 * observed history as a solid line, the Monte-Carlo P10-P90 envelope as a translucent
 * band, the P50 path dashed, and a divider where history ends and projection begins.
 * Colors ride CSS variables; the band uses color-mix so no SVG defs/ids are needed.
 */

const VB_W = 560;
const VB_H = 170;
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

export function ProjectionChart({
  history,
  band,
  formatValue = (n) => n.toLocaleString(),
  color = "var(--accent-2)",
}: {
  history: readonly SeriesPoint[];
  band: readonly BandPoint[];
  formatValue?: (n: number) => string;
  color?: string;
}): ReactNode {
  if (history.length < 2) return null;

  const start = history[0]!.capturedOn;
  const lastHist = history[history.length - 1]!;
  const end = band.length > 0 ? band[band.length - 1]!.date : lastHist.capturedOn;
  const totalDays = Math.max(1, daysBetween(start, end));

  const values = [
    ...history.map((p) => p.value),
    ...band.flatMap((b) => [b.p10, b.p90]),
  ];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || 1;
  const yMin = rawMin - span * 0.08;
  const yMax = rawMax + span * 0.08;

  const innerW = VB_W - PAD_X * 2;
  const innerH = VB_H - PAD_TOP - PAD_BOTTOM;
  const x = (date: string): number => PAD_X + (daysBetween(start, date) / totalDays) * innerW;
  const y = (v: number): number => PAD_TOP + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const pt = (px: number, py: number): string => `${Math.round(px * 10) / 10},${Math.round(py * 10) / 10}`;
  const historyPts = history.map((p) => pt(x(p.capturedOn), y(p.value))).join(" ");

  // The band + median start from the last observed point so they connect visually.
  const junction = pt(x(lastHist.capturedOn), y(lastHist.value));
  const bandPts =
    band.length > 0
      ? [
          junction,
          ...band.map((b) => pt(x(b.date), y(b.p90))),
          ...[...band].reverse().map((b) => pt(x(b.date), y(b.p10))),
          junction,
        ].join(" ")
      : null;
  const medianPts = band.length > 0 ? [junction, ...band.map((b) => pt(x(b.date), y(b.p50)))].join(" ") : null;

  const todayX = x(lastHist.capturedOn);
  const terminal = band.length > 0 ? band[band.length - 1]! : null;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="History and projected range"
    >
      {bandPts && <polygon points={bandPts} fill={`color-mix(in srgb, ${color} 16%, transparent)`} stroke="none" />}
      <polyline
        points={historyPts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {medianPts && (
        <polyline
          points={medianPts}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          opacity={0.85}
        />
      )}
      <line x1={todayX} y1={PAD_TOP} x2={todayX} y2={PAD_TOP + innerH} stroke="var(--border)" strokeDasharray="2 3" />

      <text x={PAD_X} y={VB_H - 8} style={{ fontSize: 10, fill: "var(--muted)" }}>
        {start}
      </text>
      <text x={todayX} y={VB_H - 8} textAnchor="middle" style={{ fontSize: 10, fill: "var(--muted)" }}>
        today
      </text>
      <text x={VB_W - PAD_X} y={VB_H - 8} textAnchor="end" style={{ fontSize: 10, fill: "var(--muted)" }}>
        {end}
      </text>
      {terminal && (
        <text
          x={VB_W - PAD_X}
          y={Math.max(PAD_TOP + 9, y(terminal.p50) - 5)}
          textAnchor="end"
          style={{ fontSize: 11, fontWeight: 700, fill: color }}
        >
          {formatValue(terminal.p50)}
        </text>
      )}
    </svg>
  );
}
