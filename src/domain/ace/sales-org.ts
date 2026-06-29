import type { RepHealth, HealthBand } from "@/domain/ace/rep-intelligence";
import type { AwsOrgTitle } from "@/domain/aws/mapping";

/**
 * Pure AWS Sales-Org rollups. Turns the per-opportunity AWS team (the
 * opportunity_aws_team junction) into rep-centric intelligence: how many OPEN
 * opportunities we co-sell with each AWS rep, the closed-won TCV per rep, by-role
 * and by-account coverage, and which deals lack a Sales Rep / PSM. No DB, no clock —
 * the caller passes the rows + the computed RepHealth (for band/recency). Deterministic.
 *
 * Pass only the AWS-team-linked opportunities (those that appear in `edges`) so the
 * by-account / coverage / summary views reflect AWS coverage, not the whole pipeline.
 */

export { type AwsOrgTitle } from "@/domain/aws/mapping";

export const AWS_ORG_TITLE_LABELS: Record<AwsOrgTitle, string> = {
  aws_sales_rep: "AWS Sales Rep",
  aws_account_owner: "AWS Account Owner",
  psm: "Partner Success Manager",
  pdm: "Partner Development Manager",
  wwps_pdm: "WWPS PDM",
  isv_sm: "ISV Success Manager",
};

// Display + primary-title priority (most customer-facing first).
const TITLE_ORDER: readonly AwsOrgTitle[] = [
  "aws_sales_rep",
  "aws_account_owner",
  "psm",
  "pdm",
  "wwps_pdm",
  "isv_sm",
];
function titlePriority(t: AwsOrgTitle): number {
  const i = TITLE_ORDER.indexOf(t);
  return i < 0 ? TITLE_ORDER.length : i;
}

export interface SalesOrgRel {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly accountName: string;
}
export interface SalesOrgOpp {
  readonly id: string;
  readonly accountName: string;
  readonly status: "open" | "won" | "lost";
  readonly amount: number;
}
export interface TeamEdge {
  readonly opportunityId: string;
  readonly relationshipId: string;
  readonly title: AwsOrgTitle;
}

export interface RepRollup {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly titles: readonly AwsOrgTitle[];
  readonly primaryTitle: AwsOrgTitle;
  readonly accounts: readonly string[];
  readonly openCount: number;
  readonly openTCV: number;
  readonly closedWonTCV: number;
  readonly dealCount: number;
  readonly band: HealthBand | null;
  readonly daysSinceContact: number | null;
  /** Open pipeline riding on a cooling relationship (weak/dormant band) — prioritize. */
  readonly atRisk: boolean;
}

/** Per-AWS-rep rollup over the junction. Band/recency/at-stake come from RepHealth. */
export function repRollups(
  rels: readonly SalesOrgRel[],
  edges: readonly TeamEdge[],
  opps: readonly SalesOrgOpp[],
  healths: readonly RepHealth[],
): RepRollup[] {
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const relById = new Map(rels.map((r) => [r.id, r]));
  const healthById = new Map(healths.map((h) => [h.id, h]));

  const byRel = new Map<string, { titles: Set<AwsOrgTitle>; oppIds: Set<string> }>();
  for (const e of edges) {
    const g = byRel.get(e.relationshipId) ?? { titles: new Set<AwsOrgTitle>(), oppIds: new Set<string>() };
    g.titles.add(e.title);
    g.oppIds.add(e.opportunityId);
    byRel.set(e.relationshipId, g);
  }

  const out: RepRollup[] = [];
  for (const [relId, g] of byRel) {
    const rel = relById.get(relId);
    if (!rel) continue;
    let openCount = 0;
    let openTCV = 0;
    let closedWonTCV = 0;
    let dealCount = 0;
    const accounts = new Set<string>();
    for (const oppId of g.oppIds) {
      const o = oppById.get(oppId);
      if (!o) continue;
      dealCount += 1;
      if (o.accountName) accounts.add(o.accountName);
      if (o.status === "open") {
        openCount += 1;
        openTCV += o.amount;
      } else if (o.status === "won") {
        closedWonTCV += o.amount;
      }
    }
    const titles = [...g.titles].sort((a, b) => titlePriority(a) - titlePriority(b));
    const h = healthById.get(relId);
    const band = h?.band ?? null;
    // At risk = real open pipeline (from the junction) riding on a cooling relationship.
    // Derived from the rollup's own openTCV, not health.atStake (which only sees the
    // single awsContactId link), so a PSM with pipeline but no primary link is caught.
    const atRisk = openTCV > 0 && (band === "weak" || band === "dormant");
    out.push({
      id: relId,
      name: rel.name,
      email: rel.email,
      titles,
      primaryTitle: titles[0]!,
      accounts: [...accounts].sort(),
      openCount,
      openTCV,
      closedWonTCV,
      dealCount,
      band,
      daysSinceContact: h?.daysSinceContact ?? null,
      atRisk,
    });
  }
  return out;
}

/** Sort reps by who needs attention / where the money is: at-risk, then open TCV, then won TCV. */
export function prioritizeReps(rollups: readonly RepRollup[]): RepRollup[] {
  return [...rollups].sort((a, b) => {
    if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1;
    if (b.openTCV !== a.openTCV) return b.openTCV - a.openTCV;
    if (b.closedWonTCV !== a.closedWonTCV) return b.closedWonTCV - a.closedWonTCV;
    return a.name.localeCompare(b.name);
  });
}

export interface RoleRollup {
  readonly title: AwsOrgTitle;
  readonly reps: number;
  readonly openCount: number;
  readonly openTCV: number;
  readonly closedWonTCV: number;
}

/** Aggregate the sales org by AWS title (which roles carry the most pipeline). */
export function rollupByRole(
  edges: readonly TeamEdge[],
  opps: readonly SalesOrgOpp[],
): RoleRollup[] {
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const byTitle = new Map<AwsOrgTitle, { reps: Set<string>; oppIds: Set<string> }>();
  for (const e of edges) {
    const g = byTitle.get(e.title) ?? { reps: new Set<string>(), oppIds: new Set<string>() };
    g.reps.add(e.relationshipId);
    g.oppIds.add(e.opportunityId);
    byTitle.set(e.title, g);
  }
  const out: RoleRollup[] = [];
  for (const [title, g] of byTitle) {
    let openCount = 0;
    let openTCV = 0;
    let closedWonTCV = 0;
    for (const oppId of g.oppIds) {
      const o = oppById.get(oppId);
      if (!o) continue;
      if (o.status === "open") {
        openCount += 1;
        openTCV += o.amount;
      } else if (o.status === "won") {
        closedWonTCV += o.amount;
      }
    }
    out.push({ title, reps: g.reps.size, openCount, openTCV, closedWonTCV });
  }
  return out.sort((a, b) => titlePriority(a.title) - titlePriority(b.title));
}

export interface AccountRollup {
  readonly account: string;
  readonly openCount: number;
  readonly openTCV: number;
  readonly closedWonTCV: number;
  readonly hasSalesRep: boolean;
  readonly hasPsm: boolean;
}

function titlesByOpp(edges: readonly TeamEdge[]): Map<string, Set<AwsOrgTitle>> {
  const m = new Map<string, Set<AwsOrgTitle>>();
  for (const e of edges) {
    const s = m.get(e.opportunityId) ?? new Set<AwsOrgTitle>();
    s.add(e.title);
    m.set(e.opportunityId, s);
  }
  return m;
}

/** Aggregate AWS-team opportunities by customer account + flag thin role coverage. */
export function rollupByAccount(
  edges: readonly TeamEdge[],
  opps: readonly SalesOrgOpp[],
): AccountRollup[] {
  const titles = titlesByOpp(edges);
  const by = new Map<
    string,
    { openCount: number; openTCV: number; closedWonTCV: number; hasSalesRep: boolean; hasPsm: boolean }
  >();
  for (const o of opps) {
    const key = o.accountName || "(unspecified)";
    const g = by.get(key) ?? { openCount: 0, openTCV: 0, closedWonTCV: 0, hasSalesRep: false, hasPsm: false };
    if (o.status === "open") {
      g.openCount += 1;
      g.openTCV += o.amount;
    } else if (o.status === "won") {
      g.closedWonTCV += o.amount;
    }
    const t = titles.get(o.id);
    if (t && (t.has("aws_sales_rep") || t.has("aws_account_owner"))) g.hasSalesRep = true;
    if (t && t.has("psm")) g.hasPsm = true;
    by.set(key, g);
  }
  return [...by.entries()]
    .map(([account, g]) => ({ account, ...g }))
    .sort((a, b) => b.openTCV - a.openTCV || a.account.localeCompare(b.account));
}

export interface CoverageGap {
  readonly opportunityId: string;
  readonly account: string;
  readonly missingSalesRep: boolean;
  readonly missingPsm: boolean;
}

/** Open AWS-team opportunities lacking a Sales Rep / Account Owner and/or a PSM. */
export function coverageGaps(
  opps: readonly SalesOrgOpp[],
  edges: readonly TeamEdge[],
): CoverageGap[] {
  const titles = titlesByOpp(edges);
  const out: CoverageGap[] = [];
  for (const o of opps) {
    if (o.status !== "open") continue;
    const t = titles.get(o.id) ?? new Set<AwsOrgTitle>();
    const missingSalesRep = !t.has("aws_sales_rep") && !t.has("aws_account_owner");
    const missingPsm = !t.has("psm");
    if (missingSalesRep || missingPsm) {
      out.push({ opportunityId: o.id, account: o.accountName || "(unspecified)", missingSalesRep, missingPsm });
    }
  }
  return out;
}

export interface PortfolioOpp extends SalesOrgOpp {
  readonly stage: string;
}

export interface RepPortfolioStage {
  readonly stage: string;
  readonly count: number;
  readonly openTCV: number;
}

export interface RepPortfolio {
  readonly titles: readonly AwsOrgTitle[];
  readonly accounts: readonly string[];
  readonly openTCV: number;
  readonly wonTCV: number;
  /** OPEN opps grouped by stage, biggest pipeline first. */
  readonly stages: readonly RepPortfolioStage[];
}

/** One AWS rep's book over the junction: their titles, the accounts they cover, and OPEN opps by stage. */
export function repPortfolio(
  repId: string,
  edges: readonly TeamEdge[],
  opps: readonly PortfolioOpp[],
): RepPortfolio {
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const titles = new Set<AwsOrgTitle>();
  const oppIds = new Set<string>();
  for (const e of edges) {
    if (e.relationshipId !== repId) continue;
    titles.add(e.title);
    oppIds.add(e.opportunityId);
  }
  const accounts = new Set<string>();
  let openTCV = 0;
  let wonTCV = 0;
  const byStage = new Map<string, { count: number; openTCV: number }>();
  for (const id of oppIds) {
    const o = oppById.get(id);
    if (!o) continue;
    if (o.accountName) accounts.add(o.accountName);
    if (o.status === "open") {
      openTCV += o.amount;
      const g = byStage.get(o.stage) ?? { count: 0, openTCV: 0 };
      g.count += 1;
      g.openTCV += o.amount;
      byStage.set(o.stage, g);
    } else if (o.status === "won") {
      wonTCV += o.amount;
    }
  }
  return {
    titles: [...titles].sort((a, b) => titlePriority(a) - titlePriority(b)),
    accounts: [...accounts].sort(),
    openTCV,
    wonTCV,
    stages: [...byStage.entries()].map(([stage, g]) => ({ stage, ...g })).sort((a, b) => b.openTCV - a.openTCV),
  };
}

export interface RoleWinRate {
  readonly title: AwsOrgTitle;
  readonly won: number;
  readonly lost: number;
  /** won / (won + lost) as a percent, or null when no deals are decided yet. */
  readonly winRate: number | null;
}

/** Per-AWS-title win rate over DECIDED deals (won + lost) the role was on. */
export function roleWinRates(
  edges: readonly TeamEdge[],
  opps: readonly SalesOrgOpp[],
): RoleWinRate[] {
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const byTitle = new Map<AwsOrgTitle, Set<string>>();
  for (const e of edges) {
    const s = byTitle.get(e.title) ?? new Set<string>();
    s.add(e.opportunityId);
    byTitle.set(e.title, s);
  }
  const out: RoleWinRate[] = [];
  for (const [title, oppIds] of byTitle) {
    let won = 0;
    let lost = 0;
    for (const id of oppIds) {
      const o = oppById.get(id);
      if (!o) continue;
      if (o.status === "won") won += 1;
      else if (o.status === "lost") lost += 1;
    }
    const decided = won + lost;
    out.push({ title, won, lost, winRate: decided > 0 ? Math.round((won / decided) * 100) : null });
  }
  return out.sort((a, b) => titlePriority(a.title) - titlePriority(b.title));
}

export interface SalesOrgSummary {
  readonly reps: number;
  readonly openTCV: number;
  readonly closedWonTCV: number;
  readonly gaps: number;
}

/** Headline stats. Pipeline sums over DISTINCT opps (never double-counts multi-rep deals). */
export function salesOrgSummary(
  opps: readonly SalesOrgOpp[],
  rollups: readonly RepRollup[],
  gaps: readonly CoverageGap[],
): SalesOrgSummary {
  let openTCV = 0;
  let closedWonTCV = 0;
  for (const o of opps) {
    if (o.status === "open") openTCV += o.amount;
    else if (o.status === "won") closedWonTCV += o.amount;
  }
  return { reps: rollups.length, openTCV, closedWonTCV, gaps: gaps.length };
}
