/**
 * Agency portfolio rollups (Bet C) — pure math over per-workspace summaries. No DB:
 * the loader builds one `WorkspaceSummary` per managed workspace (reusing the Command
 * Center aggregation), and these functions fold them into a portfolio-level view and
 * order them for the operator. Exhaustively unit-testable.
 */

export interface WorkspaceRisk {
  readonly title: string;
  readonly severity: string;
}

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly tier: string;
  /** Service-package entitlement ("essentials" | "growth" | "enterprise"). */
  readonly plan: string;
  /** Partnership health 0-100 + its band ("strong" | "fair" | "at_risk"). */
  readonly health: number;
  readonly band: string;
  readonly openWork: number;
  readonly overdue: number;
  /** Count of renewal_due decisions in this workspace. */
  readonly renewalsDue: number;
  /** Total open decisions ("needs attention") in this workspace. */
  readonly attention: number;
  /** Sum of open opportunity amounts (pipeline). */
  readonly pipeline: number;
  readonly topRisk: WorkspaceRisk | null;
}

export interface PortfolioRollup {
  readonly count: number;
  readonly avgHealth: number;
  readonly atRisk: number;
  readonly openWork: number;
  readonly overdue: number;
  readonly renewalsDue: number;
  readonly pipeline: number;
  readonly attention: number;
  readonly tierMix: Readonly<Record<string, number>>;
}

export const EMPTY_ROLLUP: PortfolioRollup = {
  count: 0,
  avgHealth: 0,
  atRisk: 0,
  openWork: 0,
  overdue: 0,
  renewalsDue: 0,
  pipeline: 0,
  attention: 0,
  tierMix: {},
};

export function portfolioRollup(ws: readonly WorkspaceSummary[]): PortfolioRollup {
  const count = ws.length;
  if (count === 0) return EMPTY_ROLLUP;
  const sum = (f: (w: WorkspaceSummary) => number): number => ws.reduce((a, w) => a + f(w), 0);
  const tierMix: Record<string, number> = {};
  for (const w of ws) tierMix[w.tier] = (tierMix[w.tier] ?? 0) + 1;
  return {
    count,
    avgHealth: Math.round(sum((w) => w.health) / count),
    atRisk: ws.filter((w) => w.band === "at_risk").length,
    openWork: sum((w) => w.openWork),
    overdue: sum((w) => w.overdue),
    renewalsDue: sum((w) => w.renewalsDue),
    pipeline: sum((w) => w.pipeline),
    attention: sum((w) => w.attention),
    tierMix,
  };
}

export type PortfolioSortKey = "health" | "attention" | "pipeline" | "name";

/**
 * Order workspaces for the portfolio grid. Default "health" surfaces the workspaces
 * that need the operator most (lowest health first).
 */
export function sortWorkspaces(
  ws: readonly WorkspaceSummary[],
  key: PortfolioSortKey = "health",
): WorkspaceSummary[] {
  const copy = ws.slice();
  switch (key) {
    case "health":
      return copy.sort((a, b) => a.health - b.health || b.overdue - a.overdue);
    case "attention":
      return copy.sort((a, b) => b.attention - a.attention);
    case "pipeline":
      return copy.sort((a, b) => b.pipeline - a.pipeline);
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
}
