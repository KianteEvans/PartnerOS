import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/ui/Sparkline";
import { FormDrawer } from "@/components/ui/FormDrawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconAce } from "@/components/ui/icons";
import { METRIC_CATALOG, metricByKey, formatMetricValue, type GoalUnit } from "@/domain/ace-goals/catalog";
import { goalProgress, STATUS_LABELS, STATUS_TONE, type StatusTone } from "@/domain/ace-goals/progress";
import { createAceGoal, updateAceGoal } from "@/domain/ace-goals/actions";

/**
 * Persistent "Co-Selling Goals" panel — sits above the ACE tabs so the targets an
 * org sets for its AWS co-sell relationship stay visible on every tab. Each goal
 * shows current-vs-target, a status badge, a pace-aware progress bar, and a
 * progress-over-time trend sparkline (from ace_goal_snapshots). Pure presentation
 * over the pure catalog/progress engines; the "Set goal" + per-goal "Edit" forms
 * go through the gated server actions.
 */

const labelStyle = { display: "grid", gap: 4, fontSize: 12 } as const;
const spanStyle = { color: "var(--muted)" } as const;
const controlStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 8px",
  color: "var(--text)",
  fontSize: 13,
} as const;

const TONE_VARS: Record<StatusTone, string> = {
  ok: "var(--ok)",
  info: "var(--info)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  neutral: "var(--accent-2)",
};

const UNIT_HINT: Record<GoalUnit, string> = { currency: "$", count: "#", percent: "%" };

export interface CoSellingGoalRow {
  readonly id: string;
  readonly metricKey: string;
  readonly targetValue: number;
  readonly periodStart: string;
  readonly targetDeadline: string | null;
  readonly status: string;
}

function SetGoalDrawer({ today }: { today: string }): ReactNode {
  return (
    <FormDrawer
      triggerLabel="Set goal"
      title="New co-selling goal"
      action={createAceGoal}
      submitLabel="Set goal"
      successMessage="Goal set."
    >
      <label style={labelStyle}>
        <span style={spanStyle}>Metric</span>
        <select name="metricKey" defaultValue="total_revenue" style={controlStyle}>
          {METRIC_CATALOG.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({UNIT_HINT[m.unit]})
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Target</span>
        <input name="targetValue" type="number" min={1} required style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Tracking from</span>
        <input name="periodStart" type="date" defaultValue={today} required style={controlStyle} />
      </label>
      <label style={labelStyle}>
        <span style={spanStyle}>Target date (optional)</span>
        <input name="targetDeadline" type="date" style={controlStyle} />
      </label>
    </FormDrawer>
  );
}

function GoalCard({
  goal,
  current,
  trend,
  today,
  canManage,
}: {
  goal: CoSellingGoalRow;
  current: number;
  trend: number[];
  today: string;
  canManage: boolean;
}): ReactNode {
  const metric = metricByKey(goal.metricKey);
  if (!metric) return null;
  const prog = goalProgress(goal, current, today);
  const overdue = prog.daysToDeadline !== null && prog.daysToDeadline < 0 && prog.status !== "achieved";
  const tone: StatusTone = overdue ? "danger" : STATUS_TONE[prog.status];
  const barColor = TONE_VARS[tone];

  const deadlineNote =
    goal.targetDeadline === null
      ? null
      : prog.daysToDeadline !== null && prog.daysToDeadline >= 0
        ? `${prog.daysToDeadline}d left`
        : `overdue ${Math.abs(prog.daysToDeadline ?? 0)}d`;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--panel)",
        padding: 14,
        display: "grid",
        gap: 8,
        alignContent: "start",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{metric.label}</span>
        <Badge tone={overdue ? "danger" : STATUS_TONE[prog.status]}>
          {overdue ? "Overdue" : STATUS_LABELS[prog.status]}
        </Badge>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {formatMetricValue(metric.unit, current)}
        </span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          / {formatMetricValue(metric.unit, goal.targetValue)} · {prog.rawPercent}%
        </span>
      </div>

      {/* Pace-aware progress bar (capped); the trend sparkline tracks it over time. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 8, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
          <div
            style={{
              width: `${prog.percent}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${barColor}, color-mix(in srgb, ${barColor} 55%, #fff))`,
              borderRadius: 999,
            }}
          />
        </div>
        {trend.length >= 2 ? <Sparkline values={trend} color={barColor} /> : null}
      </div>

      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
        {prog.status === "achieved" ? "Target reached" : `${formatMetricValue(metric.unit, prog.remaining)} to go`}
        {metric.windowed ? ` · since ${goal.periodStart}` : " · current"}
        {deadlineNote ? ` · ${deadlineNote}` : ""}
      </div>

      {canManage && (
        <div style={{ marginTop: 2 }}>
          <FormDrawer
            triggerLabel="Edit"
            triggerVariant="secondary"
            title="Edit goal"
            action={updateAceGoal}
            hidden={{ goalId: goal.id }}
            submitLabel="Save"
            successMessage="Goal updated."
          >
            <label style={labelStyle}>
              <span style={spanStyle}>Target</span>
              <input name="targetValue" type="number" min={1} defaultValue={goal.targetValue} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Target date</span>
              <input name="targetDeadline" type="date" defaultValue={goal.targetDeadline ?? ""} style={controlStyle} />
            </label>
            <label style={labelStyle}>
              <span style={spanStyle}>Status</span>
              <select name="status" defaultValue={goal.status} style={controlStyle}>
                <option value="active">Active</option>
                <option value="archived">Archived (hide)</option>
              </select>
            </label>
          </FormDrawer>
        </div>
      )}
    </div>
  );
}

export function CoSellingGoals({
  goals,
  currentByGoalId,
  trendsByGoalId,
  today,
  canManage,
}: {
  goals: readonly CoSellingGoalRow[];
  currentByGoalId: ReadonlyMap<string, number>;
  trendsByGoalId: ReadonlyMap<string, number[]>;
  today: string;
  canManage: boolean;
}): ReactNode {
  return (
    <Panel
      title="Co-Selling Goals"
      accent="var(--section-accent)"
      actions={canManage ? <SetGoalDrawer today={today} /> : undefined}
    >
      {goals.length === 0 ? (
        <EmptyState
          icon={<IconAce size={28} />}
          title="No co-selling goals yet"
          hint="Set targets for your AWS co-sell relationship — total revenue, net new AWS rep relationships, AWS-originated opportunities — and track progress here on every tab."
          action={canManage ? <SetGoalDrawer today={today} /> : undefined}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              current={currentByGoalId.get(g.id) ?? 0}
              trend={trendsByGoalId.get(g.id) ?? []}
              today={today}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
