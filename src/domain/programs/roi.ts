import type { OpportunityStage, OpportunityStatus } from "@/domain/ace/opportunities";

/**
 * Pure Competency ROI engine. Given the ACE opportunities attributed to a program
 * (opportunities.program_id) and the date the program was achieved, roll up the
 * return: open / won / launched counts + TCV, and a CONSERVATIVE "won since
 * achieved" influence number. No DB, no clock — the caller passes `achievedAt`.
 * Deterministic and unit-testable, like solutions/renewal.ts.
 *
 * INVARIANT: open / won / launched are LABELLED VIEWS of the same attributed rows
 * (a launched deal is usually also won), surfaced in separate cells and NEVER summed
 * together. `attributedCount` is the only total over all rows (incl. lost).
 *
 * Influence is deliberately conservative — a deal counts only if it is attributed to
 * this competency AND was won on/after the achievement date (`closeDate >= achievedAt`,
 * inclusive). A won deal with no close date can't be proven to post-date achievement,
 * so it is excluded. When the program has no achievement date the influence is `null`
 * (unknowable), never a misleading `0`.
 */

export interface RoiOppLike {
  readonly status: OpportunityStatus;
  readonly stage: OpportunityStage;
  readonly amount: number;
  readonly closeDate: string | null;
}

export interface ProgramRoi {
  /** All attributed opportunities, including lost ones. */
  readonly attributedCount: number;
  readonly openCount: number;
  readonly openTCV: number;
  readonly wonCount: number;
  readonly wonTCV: number;
  readonly launchedCount: number;
  readonly launchedTCV: number;
  /** Won on/after achievement (conservative). `null` when achievedAt is unknown. */
  readonly influencedWonCount: number | null;
  readonly influencedWonTCV: number | null;
}

/** Roll up the opportunities attributed to one program. */
export function programRoi(
  opps: readonly RoiOppLike[],
  achievedAt: string | null,
): ProgramRoi {
  let openCount = 0;
  let openTCV = 0;
  let wonCount = 0;
  let wonTCV = 0;
  let launchedCount = 0;
  let launchedTCV = 0;
  let influencedWonCount = 0;
  let influencedWonTCV = 0;

  for (const o of opps) {
    if (o.status === "open") {
      openCount += 1;
      openTCV += o.amount;
    } else if (o.status === "won") {
      wonCount += 1;
      wonTCV += o.amount;
      if (achievedAt !== null && o.closeDate !== null && o.closeDate >= achievedAt) {
        influencedWonCount += 1;
        influencedWonTCV += o.amount;
      }
    }
    if (o.stage === "launched") {
      launchedCount += 1;
      launchedTCV += o.amount;
    }
  }

  return {
    attributedCount: opps.length,
    openCount,
    openTCV,
    wonCount,
    wonTCV,
    launchedCount,
    launchedTCV,
    influencedWonCount: achievedAt === null ? null : influencedWonCount,
    influencedWonTCV: achievedAt === null ? null : influencedWonTCV,
  };
}

export interface RoiRollupRow {
  readonly name: string;
  readonly roi: ProgramRoi;
}

export interface RoiRollup {
  /** Number of competencies in the rollup. */
  readonly programs: number;
  readonly attributedCount: number;
  readonly openTCV: number;
  readonly wonTCV: number;
  /** Sum of conservative influence across competencies that have an achievement date. */
  readonly influencedWonTCV: number;
  /** Won TCV per competency, highest first — drives the portfolio BarChart. */
  readonly byProgram: readonly { readonly name: string; readonly wonTCV: number }[];
}

/** Portfolio-level rollup across competencies. Each bucket sums independently. */
export function roiRollup(rows: readonly RoiRollupRow[]): RoiRollup {
  let attributedCount = 0;
  let openTCV = 0;
  let wonTCV = 0;
  let influencedWonTCV = 0;
  for (const { roi } of rows) {
    attributedCount += roi.attributedCount;
    openTCV += roi.openTCV;
    wonTCV += roi.wonTCV;
    influencedWonTCV += roi.influencedWonTCV ?? 0;
  }
  const byProgram = rows
    .map((r) => ({ name: r.name, wonTCV: r.roi.wonTCV }))
    .sort((a, b) => b.wonTCV - a.wonTCV || a.name.localeCompare(b.name));
  return {
    programs: rows.length,
    attributedCount,
    openTCV,
    wonTCV,
    influencedWonTCV,
    byProgram,
  };
}
