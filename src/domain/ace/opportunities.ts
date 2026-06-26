import { addDays } from "@/domain/dates";

/**
 * Pure ACE opportunity intelligence: prioritization, hygiene diagnostics,
 * pipeline summary, and rep workload. No database, no clock — the caller passes
 * `today` (YYYY-MM-DD). Deterministic and unit-testable.
 */

export type OpportunityStage =
  | "prospect"
  | "qualified"
  | "tech_validation"
  | "business_validation"
  | "committed"
  | "launched"
  | "closed_lost";

export type OpportunityStatus = "open" | "won" | "lost";
export type OpportunitySource =
  | "partner_originated"
  | "amazon_originated"
  | "marketplace";
export type RoutingStatus = "unrouted" | "routed" | "approved";

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospect: "Prospect",
  qualified: "Qualified",
  tech_validation: "Technical validation",
  business_validation: "Business validation",
  committed: "Committed",
  launched: "Launched",
  closed_lost: "Closed lost",
};

export const SOURCE_LABELS: Record<OpportunitySource, string> = {
  partner_originated: "Partner-originated",
  amazon_originated: "Amazon-originated",
  marketplace: "Marketplace",
};

/** Productive stages in order; closed_lost is terminal and off the ladder. */
const PRODUCTIVE_STAGES: readonly OpportunityStage[] = [
  "prospect",
  "qualified",
  "tech_validation",
  "business_validation",
  "committed",
  "launched",
];

export const STALE_DAYS = 30;
export const HIGH_VALUE_THRESHOLD = 100_000;

export interface OppLike {
  readonly status: OpportunityStatus;
  readonly stage: OpportunityStage;
  readonly amount: number;
  readonly source: OpportunitySource;
  readonly ownerUserId: string | null;
  readonly nextStep: string;
  readonly lastInteraction: string | null;
  readonly closeDate: string | null;
  readonly routingStatus: RoutingStatus;
}

/** 0–1 progress along the productive stage ladder (closed_lost is 0). */
export function stageProgress(stage: OpportunityStage): number {
  const idx = PRODUCTIVE_STAGES.indexOf(stage);
  if (idx < 0) return 0;
  return idx / (PRODUCTIVE_STAGES.length - 1);
}

export function isHighValue(o: OppLike): boolean {
  return o.amount >= HIGH_VALUE_THRESHOLD;
}

/** Open with no recent interaction (or none at all). */
export function isStale(o: OppLike, today: string): boolean {
  if (o.status !== "open") return false;
  if (o.lastInteraction === null) return true;
  return o.lastInteraction < addDays(today, -STALE_DAYS);
}

/** Open and either stale or past its close date. */
export function isAtRisk(o: OppLike, today: string): boolean {
  if (o.status !== "open") return false;
  if (isStale(o, today)) return true;
  return o.closeDate !== null && o.closeDate < today;
}

/** Data-hygiene issues for an open opportunity. */
export function hygieneIssues(o: OppLike, today: string): string[] {
  if (o.status !== "open") return [];
  const issues: string[] = [];
  if (o.ownerUserId === null) issues.push("No internal owner");
  if (o.nextStep.trim().length === 0) issues.push("No next step");
  if (o.closeDate === null) issues.push("No close date");
  if (isStale(o, today)) issues.push("Stale interaction");
  return issues;
}

/** Priority 0–100 for an open opportunity (closed scores 0). */
export function priorityScore(o: OppLike, today: string): number {
  if (o.status !== "open") return 0;
  const value = Math.min(40, Math.round(o.amount / 5_000));
  const stage = Math.round(stageProgress(o.stage) * 30);
  const risk = isAtRisk(o, today) ? 30 : 0;
  return Math.min(100, value + stage + risk);
}

export type OppView =
  | "all"
  | "high_value"
  | "at_risk"
  | "stale"
  | "unrouted"
  | "amazon"
  | "marketplace"
  | "won";

export const OPP_VIEWS: readonly OppView[] = [
  "all",
  "high_value",
  "at_risk",
  "stale",
  "unrouted",
  "amazon",
  "marketplace",
  "won",
];

export const OPP_VIEW_LABELS: Record<OppView, string> = {
  all: "All open",
  high_value: "High value",
  at_risk: "At risk",
  stale: "Stale",
  unrouted: "Unrouted",
  amazon: "Amazon-originated",
  marketplace: "Marketplace",
  won: "Won",
};

function matchesView(o: OppLike, view: OppView, today: string): boolean {
  switch (view) {
    case "all":
      return o.status === "open";
    case "high_value":
      return o.status === "open" && isHighValue(o);
    case "at_risk":
      return isAtRisk(o, today);
    case "stale":
      return isStale(o, today);
    case "unrouted":
      return o.status === "open" && o.routingStatus === "unrouted";
    case "amazon":
      return o.status === "open" && o.source === "amazon_originated";
    case "marketplace":
      return o.status === "open" && o.source === "marketplace";
    case "won":
      return o.status === "won";
  }
}

export interface ViewContext {
  readonly today: string;
}

export function filterOpportunities<T extends OppLike>(
  opps: readonly T[],
  view: OppView,
  ctx: ViewContext,
): T[] {
  return opps
    .filter((o) => matchesView(o, view, ctx.today))
    .slice()
    .sort((a, b) => priorityScore(b, ctx.today) - priorityScore(a, ctx.today));
}

export function viewCounts(
  opps: readonly OppLike[],
  ctx: ViewContext,
): Record<OppView, number> {
  const counts = {} as Record<OppView, number>;
  for (const view of OPP_VIEWS) {
    counts[view] = opps.filter((o) => matchesView(o, view, ctx.today)).length;
  }
  return counts;
}

export interface PipelineSummary {
  readonly open: number;
  readonly openValue: number;
  readonly won: number;
  readonly wonValue: number;
  readonly atRisk: number;
  readonly unrouted: number;
  readonly bySource: Record<OpportunitySource, number>;
}

export function pipelineSummary(
  opps: readonly OppLike[],
  today: string,
): PipelineSummary {
  const open = opps.filter((o) => o.status === "open");
  const won = opps.filter((o) => o.status === "won");
  return {
    open: open.length,
    openValue: open.reduce((s, o) => s + o.amount, 0),
    won: won.length,
    wonValue: won.reduce((s, o) => s + o.amount, 0),
    atRisk: opps.filter((o) => isAtRisk(o, today)).length,
    unrouted: open.filter((o) => o.routingStatus === "unrouted").length,
    bySource: {
      partner_originated: open.filter((o) => o.source === "partner_originated").length,
      amazon_originated: open.filter((o) => o.source === "amazon_originated").length,
      marketplace: open.filter((o) => o.source === "marketplace").length,
    },
  };
}

export interface RepLoad {
  readonly ownerUserId: string;
  readonly openCount: number;
  readonly openValue: number;
}

/** Open-opportunity load per internal owner, busiest first. */
export function repWorkload(opps: readonly OppLike[]): RepLoad[] {
  const byOwner = new Map<string, RepLoad>();
  for (const o of opps) {
    if (o.status !== "open" || o.ownerUserId === null) continue;
    const cur = byOwner.get(o.ownerUserId) ?? {
      ownerUserId: o.ownerUserId,
      openCount: 0,
      openValue: 0,
    };
    byOwner.set(o.ownerUserId, {
      ownerUserId: o.ownerUserId,
      openCount: cur.openCount + 1,
      openValue: cur.openValue + o.amount,
    });
  }
  return [...byOwner.values()].sort((a, b) => b.openValue - a.openValue);
}

export interface FunnelStage {
  readonly stage: OpportunityStage;
  readonly label: string;
  readonly count: number;
  readonly value: number;
}

/** Productive co-sell ladder for the funnel (terminal closed_lost is excluded). */
export const FUNNEL_STAGES: readonly OpportunityStage[] = [
  "prospect",
  "qualified",
  "tech_validation",
  "business_validation",
  "committed",
  "launched",
];

/** Opportunity count + total value at each productive stage (prospect -> launched). */
export function stageFunnel(opps: readonly OppLike[]): FunnelStage[] {
  return FUNNEL_STAGES.map((stage) => {
    const inStage = opps.filter((o) => o.stage === stage);
    return {
      stage,
      label: STAGE_LABELS[stage],
      count: inStage.length,
      value: inStage.reduce((s, o) => s + o.amount, 0),
    };
  });
}

/** Win rate over CLOSED opps: won / (won + lost). Null when nothing has closed yet. */
export function winRate(opps: readonly OppLike[]): number | null {
  const won = opps.filter((o) => o.status === "won").length;
  const lost = opps.filter((o) => o.status === "lost").length;
  const closed = won + lost;
  return closed > 0 ? Math.round((won / closed) * 100) : null;
}
