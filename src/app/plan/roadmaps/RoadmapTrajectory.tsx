import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { MetricCard } from "@/components/ui/MetricCard";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { Callout } from "@/components/ui/Callout";
import { Badge, type Tone } from "@/components/ui/Badge";
import { trendDelta } from "@/domain/trend";
import type { RoadmapForecast } from "@/domain/roadmaps/forecast";

/**
 * Trajectory panel for a roadmap: a burn-up sparkline (milestones done over time),
 * a projected completion date, an on-track / behind read, and the at-risk milestone
 * list. Pure server render over the precomputed forecast + done-count series; sits
 * alongside the static progress header without touching it.
 */

const SECTION = "var(--section-accent)";

export function RoadmapTrajectory({
  forecast,
  series,
}: {
  forecast: RoadmapForecast;
  series: readonly number[];
}): ReactNode {
  const { onTrack, basis } = forecast;
  const finishTone: Tone = onTrack === true ? "ok" : onTrack === false ? "danger" : "neutral";

  const paceLabel =
    forecast.paceDays === null
      ? "—"
      : forecast.paceDays === 0
        ? "on plan"
        : forecast.paceDays > 0
          ? `${forecast.paceDays}d ahead`
          : `${Math.abs(forecast.paceDays)}d behind`;

  const callout: { tone: Tone; title: string; body: string } =
    basis === "complete"
      ? { tone: "ok", title: "Complete", body: "Every milestone is done." }
      : onTrack === true
        ? {
            tone: "ok",
            title: "On track",
            body: `Projected to finish ${forecast.projectedCompletionDate} — at or ahead of the planned end.`,
          }
        : onTrack === false
          ? {
              tone: "danger",
              title: "Behind schedule",
              body: `At the current pace you'll finish ${forecast.projectedCompletionDate}, after the planned ${forecast.plannedEnd}.`,
            }
          : {
              tone: "info",
              title: "Not enough signal yet",
              body: "Keep updating milestone statuses — the burn-up builds a forecast as you go.",
            };

  const basisNote =
    basis === "velocity"
      ? " Forecast from recent completion velocity."
      : basis === "naive"
        ? " Estimated from progress so far (limited history)."
        : "";

  return (
    <Panel title="Trajectory" accent={SECTION}>
      <MetricStrip min={170}>
        <MetricCard
          label="Milestones done"
          value={`${forecast.done}/${forecast.total}`}
          trend={
            series.length >= 2
              ? { values: series, delta: trendDelta(series), deltaSuffix: " this week" }
              : undefined
          }
        />
        <MetricCard label="Projected finish" value={forecast.projectedCompletionDate ?? "—"} tone={finishTone} />
        <MetricCard label="Pace" value={paceLabel} tone={finishTone} />
      </MetricStrip>

      <div style={{ marginTop: 12 }}>
        <Callout tone={callout.tone} title={callout.title}>
          {callout.body}
          {basisNote ? <span style={{ color: "var(--muted)" }}>{basisNote}</span> : null}
        </Callout>
      </div>

      {forecast.atRiskMilestones.length > 0 ? (
        <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>At-risk milestones</span>
          {forecast.atRiskMilestones.slice(0, 6).map((m, i) => (
            <div
              key={`${m.targetDate}-${i}`}
              style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}
            >
              <Badge tone={m.reason === "overdue" ? "danger" : "warn"}>
                {m.reason === "overdue" ? "Overdue" : "Unreachable at pace"}
              </Badge>
              <span>{m.title}</span>
              <span style={{ color: "var(--muted)", marginLeft: "auto" }}>{m.targetDate}</span>
            </div>
          ))}
          {forecast.atRiskMilestones.length > 6 ? (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              +{forecast.atRiskMilestones.length - 6} more
            </span>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
