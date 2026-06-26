import type { ReactNode } from "react";
import { RingGauge } from "@/components/ui/RingGauge";
import { BarChart } from "@/components/ui/BarChart";
import { Badge } from "@/components/ui/Badge";
import type { RoadmapProgress } from "@/domain/roadmaps/progress";

/**
 * The roadmap's at-a-glance health: a completion ring, the status distribution,
 * and the next-due / overdue callouts. Pure server render from the milestone
 * rollup — no client JS. Reuses the shared RingGauge + BarChart primitives.
 */
export function RoadmapProgressHeader({
  progress,
}: {
  progress: RoadmapProgress;
}): ReactNode {
  const { total, done, percentDone, overdue, nextDue } = progress;
  const statusData = [
    { label: "Done", value: progress.done, color: "var(--ok)" },
    { label: "In progress", value: progress.inProgress, color: "var(--info)" },
    { label: "Blocked", value: progress.blocked, color: "var(--danger)" },
    { label: "Planned", value: progress.planned, color: "var(--muted)" },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <RingGauge
        value={percentDone}
        max={100}
        size={108}
        label={`${percentDone}%`}
        caption="complete"
        color={percentDone >= 100 ? "var(--ok)" : "var(--accent)"}
      />
      <div style={{ flex: "1 1 280px", minWidth: 240 }}>
        <BarChart
          data={statusData}
          max={total || 1}
          formatValue={(n) => String(n)}
        />
      </div>
      <div style={{ display: "grid", gap: 8, fontSize: 13, minWidth: 130 }}>
        <div>
          <span style={{ color: "var(--muted)" }}>Milestones </span>
          <strong>
            {done}/{total}
          </strong>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>Next due </span>
          <strong>{nextDue ?? "—"}</strong>
        </div>
        {overdue > 0 ? (
          <Badge tone="danger">
            {overdue} overdue
          </Badge>
        ) : (
          <Badge tone="ok">On track</Badge>
        )}
      </div>
    </div>
  );
}
