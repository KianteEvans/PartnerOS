import type { OpportunitySource, OpportunityStage } from "@/domain/ace/opportunities";

/**
 * Pure win/loss mining: learn from CLOSED deals. Given loader-shaped ClosedDeals
 * (outcome + the cross-domain factors that backed each deal) compute overall stats,
 * cohort win rates (source / size band), loss-reason + stage-at-loss breakdowns, and
 * honest FACTOR LIFTS (win rate with vs without each factor, small-sample suppressed).
 * Correlation, not causation — the surfaces say so. Plus rep win intelligence: which
 * AWS relationships' deals actually close won (the relationship-graph half).
 * No database, no clock. Deterministic and unit-testable.
 */

// ---------------------------------------------------------------------------
// Loss-reason catalog (drizzle/0051). Keep in sync with lossReasonEnum in
// @/domain/ace/schemas. "" = not recorded.
// ---------------------------------------------------------------------------
export const LOSS_REASONS = ["competitor", "price", "timing", "no_budget", "scope", "other"] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  competitor: "Lost to competitor",
  price: "Price",
  timing: "Timing",
  no_budget: "No budget",
  scope: "Scope mismatch",
  other: "Other",
};

/** Minimum closed deals PER SIDE before a factor lift is trusted. */
export const MIN_SAMPLE = 3;

export interface ClosedDeal {
  readonly id: string;
  readonly name: string;
  readonly status: "won" | "lost";
  readonly amount: number;
  readonly source: OpportunitySource;
  readonly stage: OpportunityStage;
  /** "" when not recorded. */
  readonly lossReason: string;
  /** ISO date (YYYY-MM-DD) the deal was created. */
  readonly createdAt: string;
  /** ISO date the deal actually closed; null for pre-0051 rows never backfilled. */
  readonly closedAt: string | null;
  readonly hasMdf: boolean;
  readonly hasFunding: boolean;
  readonly hasOffer: boolean;
  readonly hasAwsTeam: boolean;
  readonly hasCompetency: boolean;
  readonly hasSolution: boolean;
}

export interface CohortRow {
  readonly key: string;
  readonly label: string;
  readonly closed: number;
  readonly won: number;
  readonly winRate: number | null;
  readonly wonTCV: number;
}

export interface FactorLift {
  readonly key: string;
  readonly label: string;
  readonly withWinRate: number | null;
  readonly withoutWinRate: number | null;
  /** withWinRate / withoutWinRate, 1dp; null when either side is null or without is 0. */
  readonly lift: number | null;
  readonly nWith: number;
  readonly nWithout: number;
  /** True when either side has fewer than MIN_SAMPLE closed deals. */
  readonly suppressed: boolean;
}

export interface LossReasonRow {
  readonly reason: string;
  readonly label: string;
  readonly count: number;
  readonly lostTCV: number;
}

export interface WinLossReport {
  readonly overall: {
    readonly closed: number;
    readonly won: number;
    readonly lost: number;
    readonly winRate: number | null;
    readonly wonTCV: number;
    readonly lostTCV: number;
    /** Mean created->closed days over WON deals with a close stamp; null when none. */
    readonly avgCycleDays: number | null;
  };
  readonly bySource: readonly CohortRow[];
  readonly bySizeBand: readonly CohortRow[];
  readonly lossReasons: readonly LossReasonRow[];
  readonly stageAtLoss: readonly { stage: OpportunityStage; count: number }[];
  readonly factors: readonly FactorLift[];
}

const SOURCE_LABELS: Record<OpportunitySource, string> = {
  partner_originated: "Partner-originated",
  amazon_originated: "Amazon-originated",
  marketplace: "Marketplace",
};

const SIZE_BANDS = [
  { key: "small", label: "< $50k", min: 0, max: 50_000 },
  { key: "mid", label: "$50k - $250k", min: 50_000, max: 250_000 },
  { key: "large", label: "> $250k", min: 250_000, max: Number.POSITIVE_INFINITY },
] as const;

export const FACTOR_LABELS: Record<string, string> = {
  mdf: "MDF-backed",
  funding: "AWS funding-backed",
  offer: "Private offer",
  awsTeam: "AWS team attached",
  competency: "Competency-attributed",
  solution: "Solution-linked",
};

function rate(won: number, closed: number): number | null {
  return closed > 0 ? Math.round((won / closed) * 100) : null;
}

function cohort(key: string, label: string, deals: readonly ClosedDeal[]): CohortRow {
  const won = deals.filter((d) => d.status === "won");
  return {
    key,
    label,
    closed: deals.length,
    won: won.length,
    winRate: rate(won.length, deals.length),
    wonTCV: won.reduce((s, d) => s + d.amount, 0),
  };
}

const DAY_MS = 86_400_000;
/** Created -> actually-closed days; null without a close stamp (or bad dates). */
export function cycleDays(d: Pick<ClosedDeal, "createdAt" | "closedAt">): number | null {
  if (!d.closedAt) return null;
  const start = Date.parse(d.createdAt);
  const end = Date.parse(d.closedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / DAY_MS);
}

function factorLift(key: string, deals: readonly ClosedDeal[], has: (d: ClosedDeal) => boolean): FactorLift {
  const withD = deals.filter(has);
  const withoutD = deals.filter((d) => !has(d));
  const withWinRate = rate(withD.filter((d) => d.status === "won").length, withD.length);
  const withoutWinRate = rate(withoutD.filter((d) => d.status === "won").length, withoutD.length);
  const lift =
    withWinRate !== null && withoutWinRate !== null && withoutWinRate > 0
      ? Math.round((withWinRate / withoutWinRate) * 10) / 10
      : null;
  return {
    key,
    label: FACTOR_LABELS[key] ?? key,
    withWinRate,
    withoutWinRate,
    lift,
    nWith: withD.length,
    nWithout: withoutD.length,
    suppressed: withD.length < MIN_SAMPLE || withoutD.length < MIN_SAMPLE,
  };
}

export function mineWinLoss(deals: readonly ClosedDeal[]): WinLossReport {
  const won = deals.filter((d) => d.status === "won");
  const lost = deals.filter((d) => d.status === "lost");

  const cycles = won.map(cycleDays).filter((n): n is number => n !== null);
  const avgCycleDays = cycles.length > 0 ? Math.round(cycles.reduce((s, n) => s + n, 0) / cycles.length) : null;

  const bySource = (Object.keys(SOURCE_LABELS) as OpportunitySource[])
    .map((s) => cohort(s, SOURCE_LABELS[s], deals.filter((d) => d.source === s)))
    .filter((c) => c.closed > 0);

  const bySizeBand = SIZE_BANDS.map((b) =>
    cohort(b.key, b.label, deals.filter((d) => d.amount >= b.min && d.amount < b.max)),
  ).filter((c) => c.closed > 0);

  const reasonMap = new Map<string, { count: number; lostTCV: number }>();
  for (const d of lost) {
    if (!d.lossReason) continue;
    const cur = reasonMap.get(d.lossReason) ?? { count: 0, lostTCV: 0 };
    reasonMap.set(d.lossReason, { count: cur.count + 1, lostTCV: cur.lostTCV + d.amount });
  }
  const lossReasons: LossReasonRow[] = [...reasonMap.entries()]
    .map(([reason, v]) => ({
      reason,
      label: LOSS_REASON_LABELS[reason as LossReason] ?? reason,
      count: v.count,
      lostTCV: v.lostTCV,
    }))
    .sort((a, b) => b.count - a.count || b.lostTCV - a.lostTCV);

  const stageMap = new Map<OpportunityStage, number>();
  for (const d of lost) stageMap.set(d.stage, (stageMap.get(d.stage) ?? 0) + 1);
  const stageAtLoss = [...stageMap.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  const factors: FactorLift[] = [
    factorLift("mdf", deals, (d) => d.hasMdf),
    factorLift("funding", deals, (d) => d.hasFunding),
    factorLift("offer", deals, (d) => d.hasOffer),
    factorLift("awsTeam", deals, (d) => d.hasAwsTeam),
    factorLift("competency", deals, (d) => d.hasCompetency),
    factorLift("solution", deals, (d) => d.hasSolution),
  ];

  return {
    overall: {
      closed: deals.length,
      won: won.length,
      lost: lost.length,
      winRate: rate(won.length, deals.length),
      wonTCV: won.reduce((s, d) => s + d.amount, 0),
      lostTCV: lost.reduce((s, d) => s + d.amount, 0),
      avgCycleDays,
    },
    bySource,
    bySizeBand,
    lossReasons,
    stageAtLoss,
    factors,
  };
}

// ---------------------------------------------------------------------------
// Relationship-graph intelligence: which AWS relationships' deals close WON.
// Attribution mirrors rep-intelligence: an opp belongs to a relationship via the
// direct awsContactId link, or (when the opp has no contact) the account-name
// fallback. Pure over CommandInputs-compatible shapes so the graph builder can
// call it directly.
// ---------------------------------------------------------------------------

export interface RepWinRel {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly accountName: string;
  readonly strength: number;
}

export interface RepWinOpp {
  readonly status: "open" | "won" | "lost";
  readonly amount: number;
  readonly accountName: string;
  readonly awsContactId: string | null;
}

export interface RepWinRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly strength: number;
  readonly closed: number;
  readonly won: number;
  readonly winRate: number | null;
  readonly wonTCV: number;
}

export interface StrengthSplit {
  /** Win rate of deals attributed to STRONG relationships (strength >= 60). */
  readonly strongWinRate: number | null;
  readonly weakWinRate: number | null;
  readonly strongClosed: number;
  readonly weakClosed: number;
}

function oppsForRel(rel: RepWinRel, opps: readonly RepWinOpp[]): RepWinOpp[] {
  return opps.filter((o) =>
    o.awsContactId ? o.awsContactId === rel.id : rel.accountName.length > 0 && o.accountName === rel.accountName,
  );
}

/** Per-relationship closed-deal outcomes, biggest won TCV first. */
export function repWinRows(rels: readonly RepWinRel[], opps: readonly RepWinOpp[]): RepWinRow[] {
  const closedOpps = opps.filter((o) => o.status !== "open");
  return rels
    .map((rel) => {
      const mine = oppsForRel(rel, closedOpps);
      const won = mine.filter((o) => o.status === "won");
      return {
        id: rel.id,
        name: rel.name,
        role: rel.role,
        strength: rel.strength,
        closed: mine.length,
        won: won.length,
        winRate: rate(won.length, mine.length),
        wonTCV: won.reduce((s, o) => s + o.amount, 0),
      };
    })
    .filter((r) => r.closed > 0)
    .sort((a, b) => b.wonTCV - a.wonTCV || b.closed - a.closed || a.name.localeCompare(b.name));
}

export const STRONG_STRENGTH = 60;

/** Do deals attributed to strong relationships win more often? */
export function strengthSplit(rels: readonly RepWinRel[], opps: readonly RepWinOpp[]): StrengthSplit {
  const closedOpps = opps.filter((o) => o.status !== "open");
  let strongWon = 0;
  let strongClosed = 0;
  let weakWon = 0;
  let weakClosed = 0;
  for (const rel of rels) {
    const mine = oppsForRel(rel, closedOpps);
    const won = mine.filter((o) => o.status === "won").length;
    if (rel.strength >= STRONG_STRENGTH) {
      strongClosed += mine.length;
      strongWon += won;
    } else {
      weakClosed += mine.length;
      weakWon += won;
    }
  }
  return {
    strongWinRate: rate(strongWon, strongClosed),
    weakWinRate: rate(weakWon, weakClosed),
    strongClosed,
    weakClosed,
  };
}
