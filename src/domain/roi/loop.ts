/**
 * Full ROI loops (Wave 2) — pure attribution of realized outcomes back to spend.
 *
 * The loop: MDF/Funding SPEND (approved) -> influenced PIPELINE (linked open deals)
 * -> WON revenue (linked won deals) -> TIER CREDIT (linked deals that reached the
 * `launched` stage, which is what real AWS tier criteria count). Each spend record
 * (an MDF request or a Funding submission) resolves to at most one primary
 * opportunity; the engine folds them into per-record ROI + a portfolio funnel that
 * also exposes where the loop LEAKS (spend with no linked deal; linked deal still
 * open). No DB, no dates — status/stage carry everything — so it is fully testable.
 */

export type SpendKind = "mdf" | "funding";

export interface LinkedOpp {
  readonly id: string;
  readonly name: string;
  readonly status: "open" | "won" | "lost";
  /** `launched` is the stage that credits tier requirements (faithful to AWS). */
  readonly stage: string;
  readonly amount: number;
}

export interface SpendRecord {
  readonly kind: SpendKind;
  readonly id: string;
  readonly title: string;
  /** Approved spend (dollars). ROI denominators use this. */
  readonly approved: number;
  /** MDF's stored expected-pipeline guess; Funding has none (0). */
  readonly expectedPipeline: number;
  /** Resolved primary opportunity id (FK, or a promoted free-text ref). */
  readonly opportunityId: string | null;
}

export interface SpendRoi extends SpendRecord {
  readonly opp: LinkedOpp | null;
  readonly influencedOpen: number;
  readonly influencedWon: number;
  readonly launched: boolean;
  /** Realized ROI = influencedWon / approved (null when nothing approved). */
  readonly realizedRoi: number | null;
  /** Expected ROI = expectedPipeline / approved (null when nothing approved). */
  readonly expectedRoi: number | null;
}

export interface RoiFunnel {
  readonly approvedSpend: number;
  readonly expectedPipeline: number;
  readonly influencedOpen: number;
  readonly influencedWon: number;
  readonly realizedRoi: number | null;
  readonly expectedRoi: number | null;
  /** Count of linked deals that reached `launched` (tier-requirement credit). */
  readonly launchedCredits: number;
  /** Approved spend with NO linked opportunity — a loop leak. */
  readonly unlinkedSpend: number;
  /** Linked deals still open — influence not yet realized. */
  readonly inFlightCount: number;
  readonly records: readonly SpendRoi[];
}

/** Ratio rounded to 2dp, or null when the denominator is non-positive. */
function ratio(numer: number, denom: number): number | null {
  return denom > 0 ? Math.round((numer / denom) * 100) / 100 : null;
}

/** Fold one spend record + its resolved opportunity into realized/expected ROI. */
export function spendRoi(record: SpendRecord, opp: LinkedOpp | null): SpendRoi {
  const influencedOpen = opp && opp.status === "open" ? opp.amount : 0;
  const influencedWon = opp && opp.status === "won" ? opp.amount : 0;
  return {
    ...record,
    opp,
    influencedOpen,
    influencedWon,
    launched: opp?.stage === "launched",
    realizedRoi: ratio(influencedWon, record.approved),
    expectedRoi: ratio(record.expectedPipeline, record.approved),
  };
}

/**
 * The full portfolio funnel. `oppsById` maps an opportunity id to its (already
 * tenant-scoped) summary; records whose id is absent are treated as unlinked leaks.
 */
export function roiLoop(
  records: readonly SpendRecord[],
  oppsById: ReadonlyMap<string, LinkedOpp>,
): RoiFunnel {
  const rows = records.map((r) =>
    spendRoi(r, r.opportunityId ? (oppsById.get(r.opportunityId) ?? null) : null),
  );
  const sum = (f: (r: SpendRoi) => number): number => rows.reduce((a, r) => a + f(r), 0);
  const approvedSpend = sum((r) => r.approved);
  const expectedPipeline = sum((r) => r.expectedPipeline);
  const influencedWon = sum((r) => r.influencedWon);
  return {
    approvedSpend,
    expectedPipeline,
    influencedOpen: sum((r) => r.influencedOpen),
    influencedWon,
    realizedRoi: ratio(influencedWon, approvedSpend),
    expectedRoi: ratio(expectedPipeline, approvedSpend),
    launchedCredits: rows.filter((r) => r.launched).length,
    unlinkedSpend: rows.filter((r) => r.opp === null).reduce((a, r) => a + r.approved, 0),
    inFlightCount: rows.filter((r) => r.opp?.status === "open").length,
    records: rows,
  };
}

/** Order the per-spend table so leaks surface first: unlinked, then in-flight, then
 *  by realized ROI ascending (worst-performing spend first). */
export function sortSpend(rows: readonly SpendRoi[]): SpendRoi[] {
  const rank = (r: SpendRoi): number => (r.opp === null ? 0 : r.opp.status === "open" ? 1 : 2);
  return rows
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (a.realizedRoi ?? 0) - (b.realizedRoi ?? 0) || b.approved - a.approved);
}
