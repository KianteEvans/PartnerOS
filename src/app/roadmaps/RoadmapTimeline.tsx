import type { ReactNode } from "react";
import { isMilestoneOverdue } from "@/domain/roadmaps/progress";

/**
 * Read-only Gantt-style timeline: each milestone is a node plotted at its target
 * date across a month axis, colored by status, joined in sequence by the critical
 * path, with a "today" marker and overdue milestones ringed red. Pure SVG (themed
 * via CSS variables) generated from the milestone data — editing stays in the list
 * view. The viewBox is 1:1 with the ~820px detail column.
 */

type Status = "planned" | "in_progress" | "done" | "blocked";

export interface TimelineMilestone {
  readonly id: string;
  readonly sequence: number;
  readonly title: string;
  readonly targetDate: string;
  readonly status: Status;
}

const STATUS_COLOR: Record<Status, string> = {
  done: "var(--ok)",
  in_progress: "var(--info)",
  blocked: "var(--danger)",
  planned: "var(--muted)",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY = 86_400_000;

function dayTs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function RoadmapTimeline({
  milestones,
  startDate,
  today,
}: {
  milestones: readonly TimelineMilestone[];
  startDate: string;
  today: string;
}): ReactNode {
  if (milestones.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
        No milestones to chart yet.
      </p>
    );
  }

  const W = 820;
  const labelW = 210;
  const trackX = labelW + 10;
  const trackRight = W - 20;
  const trackW = trackRight - trackX;
  const axisY = 22;
  const rowH = 30;
  const top = 42;
  const H = top + milestones.length * rowH + 12;

  const targets = milestones.map((m) => dayTs(m.targetDate));
  const rawMin = Math.min(dayTs(startDate), ...targets);
  const rawMax = Math.max(dayTs(today), ...targets);
  const pad = Math.max(rawMax - rawMin, DAY) * 0.04;
  const minTs = rawMin - pad;
  const span = rawMax + pad - minTs;
  const x = (ts: number): number => trackX + ((ts - minTs) / span) * trackW;

  // First-of-month gridlines within the visible range.
  const months: Array<{ ts: number; label: string }> = [];
  const startD = new Date(minTs);
  let mYear = startD.getUTCFullYear();
  let mMonth = startD.getUTCMonth();
  let mTs = Date.UTC(mYear, mMonth, 1);
  if (mTs < minTs) {
    mMonth += 1;
    if (mMonth > 11) { mMonth = 0; mYear += 1; }
    mTs = Date.UTC(mYear, mMonth, 1);
  }
  while (mTs <= minTs + span && months.length < 24) {
    months.push({ ts: mTs, label: MONTHS[mMonth]! });
    mMonth += 1;
    if (mMonth > 11) { mMonth = 0; mYear += 1; }
    mTs = Date.UTC(mYear, mMonth, 1);
  }

  const todayTs = dayTs(today);
  const showToday = todayTs >= minTs && todayTs <= minTs + span;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Roadmap timeline">
      {months.map((m) => (
        <g key={m.ts}>
          <line
            x1={x(m.ts)}
            y1={axisY + 6}
            x2={x(m.ts)}
            y2={H - 8}
            stroke="var(--border)"
            strokeWidth={0.5}
            strokeDasharray="3 3"
          />
          <text x={x(m.ts)} y={axisY} textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted)" }}>
            {m.label}
          </text>
        </g>
      ))}

      {showToday && (
        <>
          <line x1={x(todayTs)} y1={axisY + 6} x2={x(todayTs)} y2={H - 8} stroke="var(--accent)" strokeWidth={1} />
          <text x={x(todayTs)} y={axisY} textAnchor="middle" style={{ fontSize: 11, fill: "var(--accent)" }}>
            today
          </text>
        </>
      )}

      <polyline
        points={milestones.map((m, i) => `${x(dayTs(m.targetDate))},${top + i * rowH}`).join(" ")}
        fill="none"
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />

      {milestones.map((m, i) => {
        const cy = top + i * rowH;
        const nx = x(dayTs(m.targetDate));
        const overdue = isMilestoneOverdue(m, today);
        const nodeColor = overdue ? "var(--danger)" : STATUS_COLOR[m.status];
        const label = `${m.sequence}. ${m.title}`;
        const text = label.length > 28 ? `${label.slice(0, 27)}…` : label;
        return (
          <g key={m.id}>
            <circle cx={10} cy={cy} r={4} fill={STATUS_COLOR[m.status]} />
            <text x={22} y={cy + 4} style={{ fontSize: 12, fill: "var(--text)" }}>
              {text}
            </text>
            {overdue && (
              <circle cx={nx} cy={cy} r={8} fill="none" stroke="var(--danger)" strokeWidth={1.5} />
            )}
            <circle cx={nx} cy={cy} r={5} fill={nodeColor} />
          </g>
        );
      })}
    </svg>
  );
}
