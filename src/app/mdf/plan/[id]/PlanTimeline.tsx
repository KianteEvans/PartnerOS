import type { ReactNode } from "react";
import { planTimelineLayout } from "@/domain/mdf/plan-insights";

/**
 * Pure-SVG marketing calendar for a plan's events: a month-gridded Gantt of
 * date-range bars (eligible = section-accent, blocked = red), with a "today" line
 * and the Dec 1 fund-request cutoff marked. Server-rendered, no JS.
 */
export interface TimelineEventView {
  readonly id: string;
  readonly title: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly blocked: boolean;
}

export function PlanTimeline({ events, today }: { events: readonly TimelineEventView[]; today: string }): ReactNode {
  const layout = planTimelineLayout(events, today);
  if (!layout) {
    return <p style={{ color: "var(--muted)", margin: 0 }}>Add start and end dates to events to see them on the calendar.</p>;
  }
  const W = 820;
  const LABEL = 190;
  const TRACK = W - LABEL;
  const rowH = 30;
  const top = 30;
  const H = top + events.length * rowH + 12;
  const x = (pct: number): number => LABEL + (pct / 100) * TRACK;
  const byId = new Map(events.map((e) => [e.id, e]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Event calendar" style={{ display: "block" }}>
      {layout.ticks.map((t, i) => (
        <g key={`t${i}`}>
          <line x1={x(t.leftPct)} y1={top - 8} x2={x(t.leftPct)} y2={H} stroke="var(--border)" strokeWidth={1} />
          <text x={x(t.leftPct) + 2} y={top - 12} fontSize={10} fill="var(--muted)">{t.label}</text>
        </g>
      ))}
      {layout.markers.map((m, i) => (
        <line key={`m${i}`} x1={x(m.leftPct)} y1={top - 8} x2={x(m.leftPct)} y2={H} stroke="var(--danger)" strokeWidth={1} strokeDasharray="3 3" />
      ))}
      {layout.todayPct !== null ? (
        <line x1={x(layout.todayPct)} y1={top - 8} x2={x(layout.todayPct)} y2={H} stroke="var(--accent-2)" strokeWidth={1.5} />
      ) : null}
      {layout.bars.map((bar, i) => {
        const ev = byId.get(bar.id)!;
        const y = top + i * rowH;
        const bx = x(bar.leftPct);
        const bw = Math.max(4, (bar.widthPct / 100) * TRACK);
        return (
          <g key={bar.id}>
            <text x={0} y={y + rowH / 2 + 4} fontSize={11} fill="var(--text)">
              {ev.title.length > 28 ? `${ev.title.slice(0, 27)}…` : ev.title}
            </text>
            <rect
              x={bx}
              y={y + 6}
              width={bw}
              height={rowH - 12}
              rx={3}
              fill={ev.blocked ? "var(--danger)" : "var(--section-accent)"}
              opacity={ev.blocked ? 0.55 : 0.9}
            />
          </g>
        );
      })}
    </svg>
  );
}
