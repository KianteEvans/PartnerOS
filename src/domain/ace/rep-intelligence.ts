import type { RelationshipRole } from "@/domain/ace/relationships";

/**
 * Pure AWS-rep relationship-health intelligence. Turns a tracked AWS contact
 * (an `aceRelationships` row: role + manual strength + last-contact date) plus the
 * co-sell opportunities in that contact's account into an explainable 0–100 health
 * score, a band, and a "pipeline at stake" risk flag — so the partner can MEASURE
 * how healthy each AWS-rep relationship is, not just record a number.
 *
 * No DB and no clock: the caller passes `today` (YYYY-MM-DD). Deterministic and
 * unit-testable. Contacts join to opportunities by account name (an AWS rep is
 * account-aligned); a precise per-opportunity link is a later increment.
 *
 * Composite: health = 0.4·recency + 0.3·strength + 0.3·momentum.
 *  - recency  — time-decay since last contact (staying in touch matters most)
 *  - strength — the manually-tracked relationship strength (0–100)
 *  - momentum — opportunity productivity in the account (pipeline, wins, origination)
 */

/** A contact's recency sub-score reaches 0 once last contact is this old (days). */
export const RECENCY_WINDOW_DAYS = 60;

export type HealthBand = "strong" | "healthy" | "fair" | "weak" | "dormant";

export const HEALTH_BAND_LABELS: Record<HealthBand, string> = {
  strong: "Strong",
  healthy: "Healthy",
  fair: "Fair",
  weak: "Weak",
  dormant: "Dormant",
};

export interface RepRelationship {
  readonly id: string;
  readonly name: string;
  readonly role: RelationshipRole;
  readonly accountName: string;
  readonly strength: number; // 0–100 manual baseline
  readonly lastContact: string | null;
}

export interface RepOpp {
  readonly accountName: string;
  readonly status: "open" | "won" | "lost";
  readonly amount: number;
  readonly source: "partner_originated" | "amazon_originated" | "marketplace";
  readonly awsContactId: string | null; // direct link to an aceRelationships row
}

export interface RepHealth {
  readonly id: string;
  readonly name: string;
  readonly role: RelationshipRole;
  readonly accountName: string;
  readonly score: number; // 0–100 composite
  readonly band: HealthBand;
  readonly recency: number; // sub-score 0–100
  readonly strength: number; // sub-score 0–100 (manual)
  readonly momentum: number; // sub-score 0–100
  readonly daysSinceContact: number | null;
  readonly openCount: number;
  readonly openValue: number; // pipeline riding on this relationship
  readonly wonValue: number;
  readonly originated: number; // amazon-originated opps in the account
  readonly atStake: boolean; // open pipeline + poor health → needs attention
}

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const norm = (s: string): string => s.trim().toLowerCase();

function dayCount(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Time-decay 0–100: 100 at last-contact-today, linearly to 0 at the window edge. */
export function recencyScore(lastContact: string | null, today: string): number {
  if (lastContact === null) return 0;
  const days = dayCount(lastContact, today);
  return clamp(Math.round(100 * (1 - days / RECENCY_WINDOW_DAYS)));
}

/** Opportunity productivity in the rep's account → 0–100 (pipeline + wins + origination). */
export function momentumScore(accountOpps: readonly RepOpp[]): number {
  let openValue = 0;
  let won = 0;
  let lost = 0;
  let originated = 0;
  for (const o of accountOpps) {
    if (o.status === "open") openValue += o.amount;
    else if (o.status === "won") won++;
    else lost++;
    if (o.source === "amazon_originated") originated++;
  }
  const pipelinePts = Math.min(50, Math.round(openValue / 10_000));
  const closed = won + lost;
  const winPts = closed > 0 ? Math.round((won / closed) * 30) : 0;
  const originationPts = Math.min(20, originated * 10);
  return clamp(pipelinePts + winPts + originationPts);
}

export function healthBand(score: number): HealthBand {
  if (score >= 75) return "strong";
  if (score >= 60) return "healthy";
  if (score >= 45) return "fair";
  if (score >= 25) return "weak";
  return "dormant";
}

export function repHealth(
  rel: RepRelationship,
  opps: readonly RepOpp[],
  today: string,
): RepHealth {
  // An opportunity counts for this rep when it's DIRECTLY linked to them; an
  // un-linked opp falls back to account proximity (an AWS rep is account-aligned).
  const account = norm(rel.accountName);
  const linked = opps.filter(
    (o) =>
      o.awsContactId === rel.id ||
      (o.awsContactId == null && account !== "" && norm(o.accountName) === account),
  );

  const recency = recencyScore(rel.lastContact, today);
  const strength = clamp(rel.strength);
  const momentum = momentumScore(linked);
  const score = clamp(Math.round(0.4 * recency + 0.3 * strength + 0.3 * momentum));
  const band = healthBand(score);

  const open = linked.filter((o) => o.status === "open");
  const openValue = open.reduce((s, o) => s + o.amount, 0);
  const wonValue = linked
    .filter((o) => o.status === "won")
    .reduce((s, o) => s + o.amount, 0);
  const originated = linked.filter((o) => o.source === "amazon_originated").length;

  return {
    id: rel.id,
    name: rel.name,
    role: rel.role,
    accountName: rel.accountName,
    score,
    band,
    recency,
    strength,
    momentum,
    daysSinceContact: rel.lastContact === null ? null : dayCount(rel.lastContact, today),
    openCount: open.length,
    openValue,
    wonValue,
    originated,
    atStake: openValue > 0 && score < 45,
  };
}

/** Health for every tracked AWS rep — most-needing-attention first. */
export function computeRepHealth(
  rels: readonly RepRelationship[],
  opps: readonly RepOpp[],
  today: string,
): RepHealth[] {
  return rels
    .map((r) => repHealth(r, opps, today))
    .sort((a, b) => {
      if (a.atStake !== b.atStake) return a.atStake ? -1 : 1;
      // At-risk: biggest pipeline first. Otherwise: healthiest first.
      return a.atStake ? b.openValue - a.openValue : b.score - a.score;
    });
}

export interface RepHealthSummary {
  readonly total: number;
  readonly avgScore: number;
  readonly byBand: Record<HealthBand, number>;
  readonly atRiskCount: number;
  readonly pipelineAtRisk: number;
}

export function repHealthSummary(healths: readonly RepHealth[]): RepHealthSummary {
  const byBand: Record<HealthBand, number> = {
    strong: 0,
    healthy: 0,
    fair: 0,
    weak: 0,
    dormant: 0,
  };
  let scoreSum = 0;
  let atRiskCount = 0;
  let pipelineAtRisk = 0;
  for (const h of healths) {
    byBand[h.band] += 1;
    scoreSum += h.score;
    if (h.atStake) {
      atRiskCount += 1;
      pipelineAtRisk += h.openValue;
    }
  }
  return {
    total: healths.length,
    avgScore: healths.length ? Math.round(scoreSum / healths.length) : 0,
    byBand,
    atRiskCount,
    pipelineAtRisk,
  };
}
