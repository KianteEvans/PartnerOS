import {
  healthFromSnapshot,
  snapshotDelta,
  type ReportSnapshot,
  type ReportHealth,
  type ReportHealthBand,
} from "@/domain/reports/metrics";
import { TIER_LABELS, type TierId } from "@/domain/tiers/catalog";
import type { TierPath } from "@/domain/tiers/path";
import { money } from "@/domain/format";

/**
 * Pure AWS QBR (Quarterly Business Review) packet builder. Assembles a partner↔AWS
 * executive narrative from a report's frozen snapshot + the previously generated report:
 * a partnership-health ARC (prior → current), the quarter's ACHIEVED results (period-
 * over-period KPI deltas framed as delivered outcomes), and next-quarter COMMITMENTS
 * (the tier path's steady ETA + the highest-leverage next moves + open co-sell pipeline).
 * Fully deterministic — no API key, no clock, no database. This is the cross-domain
 * quarterly story ACE cannot assemble. Rendered by the QBR-aware /reports/[id]/print.
 */

const BAND_WORD: Record<ReportHealthBand, string> = {
  strong: "strong",
  fair: "fair",
  at_risk: "at risk",
};

const tierLabel = (id: string): string => TIER_LABELS[id as TierId] ?? id;

export type MoveDirection = "up" | "down" | "flat" | "new";

export interface QbrKpi {
  readonly label: string;
  readonly current: number;
  readonly prior: number | null;
  readonly delta: number | null;
  readonly invert: boolean;
  readonly direction: MoveDirection;
  /** Whether the movement is favorable (null when flat or no prior period). */
  readonly favorable: boolean | null;
}

export interface QbrHealthArc {
  readonly current: ReportHealth;
  readonly priorScore: number | null;
  readonly priorBand: ReportHealthBand | null;
  readonly delta: number | null;
  readonly narrative: string;
}

export interface QbrTierOutlook {
  readonly current: string;
  readonly target: string;
  readonly percent: number;
  readonly remaining: number;
  readonly etaDate: string | null;
  readonly ready: boolean;
  readonly narrative: string;
}

export interface QbrCommitment {
  readonly title: string;
  readonly detail: string;
  readonly link: string;
}

/** The next-best-action shape the packet needs — the caller maps from RankedAction. */
export interface QbrMove {
  readonly title: string;
  readonly detail: string;
  readonly link: string;
}

export interface QbrPacket {
  readonly headline: string;
  readonly healthArc: QbrHealthArc;
  readonly achieved: readonly QbrKpi[];
  readonly tierOutlook: QbrTierOutlook | null;
  readonly commitments: readonly QbrCommitment[];
}

function directionOf(delta: number | null): MoveDirection {
  if (delta === null) return "new";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

function favorableOf(delta: number | null, invert: boolean): boolean | null {
  if (delta === null || delta === 0) return null;
  return invert ? delta < 0 : delta > 0;
}

function buildHealthArc(snapshot: ReportSnapshot, prior: ReportSnapshot | null): QbrHealthArc {
  const current = healthFromSnapshot(snapshot);
  const priorHealth = prior ? healthFromSnapshot(prior) : null;
  const priorScore = priorHealth ? priorHealth.score : null;
  const priorBand = priorHealth ? priorHealth.band : null;
  const delta = priorScore === null ? null : current.score - priorScore;

  let narrative: string;
  if (priorScore === null || priorBand === null) {
    narrative = `Partnership health stands at ${current.score}/100 (${BAND_WORD[current.band]}) — this quarter sets the QBR baseline.`;
  } else if (current.score > priorScore) {
    narrative = `Partnership health improved from ${priorScore}/100 (${BAND_WORD[priorBand]}) to ${current.score}/100 (${BAND_WORD[current.band]}) this quarter.`;
  } else if (current.score < priorScore) {
    narrative = `Partnership health moved from ${priorScore}/100 (${BAND_WORD[priorBand]}) to ${current.score}/100 (${BAND_WORD[current.band]}) this quarter — a focus area heading into next quarter.`;
  } else {
    narrative = `Partnership health held steady at ${current.score}/100 (${BAND_WORD[current.band]}) this quarter.`;
  }
  return { current, priorScore, priorBand, delta, narrative };
}

function buildTierOutlook(snapshot: ReportSnapshot, path: TierPath | null): QbrTierOutlook | null {
  if (!snapshot.tier) return null;
  const current = tierLabel(snapshot.tier.current);
  const target = tierLabel(snapshot.tier.target);
  const percent = snapshot.tier.percent;
  const ready = path ? path.achievable : snapshot.tier.met >= snapshot.tier.total;
  const remaining = path ? path.remaining : Math.max(0, snapshot.tier.total - snapshot.tier.met);
  const steady = path?.scenarios.find((s) => s.id === "steady") ?? path?.scenarios[0];
  const etaDate = steady?.etaDate ?? null;

  const narrative = ready
    ? `All gating requirements for ${target} are met — ready to submit for advancement.`
    : etaDate
      ? `${remaining} requirement${remaining === 1 ? "" : "s"} remain for ${target} (${percent}% there). On a steady pace, the projected ready date is ${etaDate}.`
      : `${remaining} requirement${remaining === 1 ? "" : "s"} remain for ${target} (${percent}% there).`;

  return { current, target, percent, remaining, etaDate, ready, narrative };
}

export function buildQbrPacket(
  snapshot: ReportSnapshot,
  prior: ReportSnapshot | null,
  moves: readonly QbrMove[],
  path: TierPath | null,
): QbrPacket {
  const healthArc = buildHealthArc(snapshot, prior);

  const achieved: QbrKpi[] = snapshotDelta(snapshot, prior).map((k) => ({
    ...k,
    direction: directionOf(k.delta),
    favorable: favorableOf(k.delta, k.invert),
  }));

  const tierOutlook = buildTierOutlook(snapshot, path);

  const commitments: QbrCommitment[] = [];
  if (tierOutlook && !tierOutlook.ready) {
    commitments.push({
      title: `Advance toward ${tierOutlook.target}`,
      detail: tierOutlook.etaDate
        ? `Close the ${tierOutlook.remaining} remaining requirement${tierOutlook.remaining === 1 ? "" : "s"} — steady-pace ETA ${tierOutlook.etaDate}.`
        : `Close the ${tierOutlook.remaining} remaining requirement${tierOutlook.remaining === 1 ? "" : "s"}.`,
      link: "/programs/tiers",
    });
  }
  for (const m of moves.slice(0, 3)) {
    commitments.push({ title: m.title, detail: m.detail, link: m.link });
  }
  if (snapshot.ace.open > 0) {
    commitments.push({
      title: `Progress ${snapshot.ace.open} open co-sell opportunit${snapshot.ace.open === 1 ? "y" : "ies"}`,
      detail: `${money(snapshot.ace.openValue)} in open ACE pipeline${snapshot.ace.atRisk > 0 ? `, ${snapshot.ace.atRisk} at risk` : ""}.`,
      link: "/ace",
    });
  }

  const headlineBits = [
    `Partnership health ${healthArc.current.score}/100 (${BAND_WORD[healthArc.current.band]})`,
    tierOutlook ? `${tierOutlook.current} → ${tierOutlook.target} at ${tierOutlook.percent}%` : null,
    `${commitments.length} commitment${commitments.length === 1 ? "" : "s"} for next quarter`,
  ].filter((b): b is string => b !== null);
  const headline = headlineBits.join(" · ");

  return { headline, healthArc, achieved, tierOutlook, commitments };
}
