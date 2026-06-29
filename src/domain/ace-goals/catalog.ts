import { pipelineSummary, winRate, type OppLike } from "@/domain/ace/opportunities";

/**
 * Co-Selling Goals metric catalog. Pure + deterministic: each metric measures a
 * current value from the ACE rows the page already loads. No DB, no clock — the
 * caller passes `today` (YYYY-MM-DD) and the goal's `periodStart`.
 *
 * "windowed" metrics measure since `periodStart` (flow: revenue/net-new counts);
 * "current" metrics ignore it and read the live point-in-time value (open
 * pipeline, win rate). Reuses the existing pipeline engines where possible.
 */

export type GoalUnit = "currency" | "count" | "percent";

/** An opportunity row with the fields the catalog needs (a superset of OppLike). */
export type GoalOpp = OppLike & { readonly createdAt: string };
/** A relationship row — only its creation date matters for "net new". */
export interface GoalRel {
  readonly createdAt: string;
}

export interface GoalData {
  readonly opps: readonly GoalOpp[];
  readonly rels: readonly GoalRel[];
  /** ISO today, for the "current" (point-in-time) metrics. */
  readonly today: string;
}

export interface GoalMetric {
  readonly key: string;
  readonly label: string;
  readonly unit: GoalUnit;
  /** True = measured since periodStart; false = current point-in-time value. */
  readonly windowed: boolean;
  readonly description: string;
  readonly measure: (data: GoalData, periodStart: string) => number;
}

export const METRIC_CATALOG: readonly GoalMetric[] = [
  {
    key: "total_revenue",
    label: "Total co-sell revenue",
    unit: "currency",
    windowed: true,
    description: "Closed-won opportunity value since the tracking start.",
    measure: (d, start) =>
      d.opps
        .filter((o) => o.status === "won" && o.closeDate !== null && o.closeDate >= start)
        .reduce((s, o) => s + o.amount, 0),
  },
  {
    key: "net_new_relationships",
    label: "Net new AWS rep relationships",
    unit: "count",
    windowed: true,
    description: "AWS rep relationships added since the tracking start.",
    measure: (d, start) => d.rels.filter((r) => r.createdAt >= start).length,
  },
  {
    key: "net_new_aws_originated_opps",
    label: "Net new AWS-originated opportunities",
    unit: "count",
    windowed: true,
    description: "Amazon-originated opportunities created since the tracking start.",
    measure: (d, start) =>
      d.opps.filter((o) => o.source === "amazon_originated" && o.createdAt >= start).length,
  },
  {
    key: "closed_won_deals",
    label: "Closed-won deals",
    unit: "count",
    windowed: true,
    description: "Opportunities won since the tracking start.",
    measure: (d, start) =>
      d.opps.filter((o) => o.status === "won" && o.closeDate !== null && o.closeDate >= start).length,
  },
  {
    key: "open_pipeline_value",
    label: "Open pipeline value",
    unit: "currency",
    windowed: false,
    description: "Current total value of open co-sell opportunities.",
    measure: (d) => pipelineSummary(d.opps, d.today).openValue,
  },
  {
    key: "win_rate",
    label: "Win rate",
    unit: "percent",
    windowed: false,
    description: "Won / (won + lost) across closed opportunities.",
    measure: (d) => winRate(d.opps) ?? 0,
  },
];

const BY_KEY = new Map(METRIC_CATALOG.map((m) => [m.key, m]));

export function metricByKey(key: string): GoalMetric | undefined {
  return BY_KEY.get(key);
}

export function isMetricKey(key: string): boolean {
  return BY_KEY.has(key);
}

export interface GoalLike {
  readonly metricKey: string;
  readonly periodStart: string;
}

/** Current measured value for a goal. 0 if the metric key is not in the catalog. */
export function measureGoal(goal: GoalLike, data: GoalData): number {
  const m = BY_KEY.get(goal.metricKey);
  return m ? m.measure(data, goal.periodStart) : 0;
}

/** Format a measured/target value for display per its unit. */
export function formatMetricValue(unit: GoalUnit, n: number): string {
  if (unit === "currency") return `$${Math.round(n).toLocaleString()}`;
  if (unit === "percent") return `${Math.round(n)}%`;
  return Math.round(n).toLocaleString();
}
