import type { ReactNode } from "react";
import { isMilestoneOverdue } from "@/domain/roadmaps/progress";
import { analyzeSchedule } from "@/domain/roadmaps/schedule";

/**
 * Read-only Gantt-style timeline: each milestone is a node plotted at its target
 * date across a month axis, colored by status, with a "today" marker. Dependencies
 * are drawn as real arrows (predecessor -> dependent); the critical path — the
 * dependency chain that determines the finish — is highlighted, and overdue /
 * schedule-conflict nodes are ringed red. Pure SVG (themed via CSS variables)
 * generated from the milestone data. The viewBox is 1:1 with the ~820px column.
 */

type Status = "planned" | "in_progress" | "done" | "blocked";

export interface TimelineMilestone {
  readonly id: string;
  readonly sequence: number;
  readonly title: string;
  readonly targetDate: string;
  readonly status: Status;
  readonly dependsOnId: string | null;
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

  // Node positions + schedule analysis (critical path, conflicts) for the edges.
  const pos = new Map<string, { x: number; y: number }>();
  milestones.forEach((m, i) => pos.set(m.id, { x: x(dayTs(m.targetDate)), y: top + i * rowH }));
  const analysis = analyzeSchedule(
    milestones.map((m) => ({
      id: m.id,
      sequence: m.sequence,
      targetDate: m.targetDate,
      dependsOnId: m.dependsOnId,
    })),
  );
  const criticalEdges = new Set<string>();
  for (let i = 0; i + 1 < analysis.criticalPath.length; i += 1) {
    criticalEdges.add(`${analysis.criticalPath[i]}->${analysis.criticalPath[i + 1]}`);
  }
  const criticalNodes = new Set(analysis.criticalPath);
  const conflictNodes = new Set(analysis.conflicts.map((c) => c.id));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Roadmap timeline">
      <defs>
        <marker id="rm-arrow" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--border)" />
        </marker>
        <marker id="rm-arrow-crit" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--section-accent)" />
        </marker>
      </defs>

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

      {/* Dependency edges: predecessor -> dependent, critical path emphasised. */}
      {milestones.map((m) => {
        if (!m.dependsOnId) return null;
        const from = pos.get(m.dependsOnId);
        const to = pos.get(m.id);
        if (!from || !to) return null;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const critical = criticalEdges.has(`${m.dependsOnId}->${m.id}`);
        return (
          <line
            key={`edge-${m.id}`}
            x1={from.x + ux * 6}
            y1={from.y + uy * 6}
            x2={to.x - ux * 9}
            y2={to.y - uy * 9}
            stroke={critical ? "var(--section-accent)" : "var(--border)"}
            strokeWidth={critical ? 2 : 1}
            strokeDasharray={critical ? undefined : "4 3"}
            markerEnd={critical ? "url(#rm-arrow-crit)" : "url(#rm-arrow)"}
          />
        );
      })}

      {milestones.map((m, i) => {
        const cy = top + i * rowH;
        const nx = x(dayTs(m.targetDate));
        const overdue = isMilestoneOverdue(m, today);
        const conflict = conflictNodes.has(m.id);
        const critical = criticalNodes.has(m.id);
        const nodeColor = overdue ? "var(--danger)" : STATUS_COLOR[m.status];
        const label = `${m.sequence}. ${m.title}`;
        const text = label.length > 28 ? `${label.slice(0, 27)}…` : label;
        return (
          <g key={m.id}>
            <circle cx={10} cy={cy} r={4} fill={STATUS_COLOR[m.status]} />
            <text x={22} y={cy + 4} style={{ fontSize: 12, fill: "var(--text)" }}>
              {text}
            </text>
            {critical && !overdue && !conflict && (
              <circle cx={nx} cy={cy} r={8} fill="none" stroke="var(--section-accent)" strokeWidth={1.5} />
            )}
            {(overdue || conflict) && (
              <circle cx={nx} cy={cy} r={8} fill="none" stroke="var(--danger)" strokeWidth={1.5} />
            )}
            <circle cx={nx} cy={cy} r={5} fill={nodeColor} />
          </g>
        );
      })}
    </svg>
  );
}
