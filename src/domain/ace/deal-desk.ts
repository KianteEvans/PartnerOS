import type { ProgramMatch } from "@/domain/funding/eligibility";
import type { RepHealth } from "@/domain/ace/rep-intelligence";
import type { ScoredCaseStudy } from "@/domain/ace/case-study-match";
import { isAtRisk, isHighValue, type OppLike } from "@/domain/ace/opportunities";

/**
 * Pure Deal Desk model: fuse one ACE opportunity's cross-domain context (funding
 * eligibility, MDF support, marketplace agreements, AWS field team) into a single
 * prescriptive picture with ranked next moves. No database, no clock — the loader
 * passes already-shaped parts + `today`. This is the fusion ACE structurally can't
 * do (it sees only the co-sell referral).
 */

export interface DealOpp extends OppLike {
  readonly id: string;
  readonly name: string;
  readonly accountName: string;
}

export interface MdfSupport {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly requestedAmount: number;
  readonly approvedAmount: number | null;
}

export interface DeskListing {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}
export interface DeskAgreement {
  readonly id: string;
  readonly agreementId: string;
  readonly offerType: string;
  readonly status: string;
  readonly totalValue: number;
}
export interface MarketplaceLeg {
  readonly listings: readonly DeskListing[];
  readonly agreements: readonly DeskAgreement[];
  readonly entitlementCount: number;
}
export interface DeskOffer {
  readonly id: string;
  readonly title: string;
  /** PrivateOfferStatus. */
  readonly status: string;
  readonly offerValue: number;
  /** The reconciled AWS agreement id (present once accepted). */
  readonly agreementId: string | null;
}

export type DealMoveKind = "deal" | "rep" | "funding" | "mdf" | "marketplace" | "proof";

export interface DealMove {
  readonly key: string;
  readonly kind: DealMoveKind;
  readonly title: string;
  readonly detail: string;
  readonly priority: number;
  readonly link?: string;
}

export interface DealDeskParts {
  readonly opp: DealOpp;
  readonly fundingMatches: readonly ProgramMatch[];
  readonly appliedProgramKeys: readonly string[];
  readonly mdf: readonly MdfSupport[];
  readonly marketplace: MarketplaceLeg;
  /** Co-sell private offers drafted for this deal (the marketplace bridge). */
  readonly offers: readonly DeskOffer[];
  readonly awsTeam: readonly RepHealth[];
  /** Relevant case studies (attached pins first, then scored suggestions). */
  readonly caseStudies: readonly ScoredCaseStudy[];
  /** Size of the tenant's whole case-study library (drives the empty states). */
  readonly caseStudyLibraryCount: number;
}

export interface DealDeskModel extends DealDeskParts {
  /** Eligible programs the deal hasn't applied for yet (ranked by score desc). */
  readonly eligibleUnapplied: readonly ProgramMatch[];
  readonly moves: readonly DealMove[];
}

function eligibleUnappliedOf(parts: DealDeskParts): ProgramMatch[] {
  return parts.fundingMatches
    .filter((m) => m.eligible && !parts.appliedProgramKeys.includes(m.program.key))
    .slice()
    .sort((a, b) => b.score - a.score);
}

/**
 * Rank the recommended next moves for the deal. Deterministic priority order:
 * rescue an at-risk high-value deal, reconnect a cooling AWS rep with pipeline at
 * stake, pursue the best unclaimed funding, back it with MDF, or prep a private
 * offer. Only surfaces a move when the underlying condition holds.
 */
export function dealMoves(parts: DealDeskParts, today: string): DealMove[] {
  const moves: DealMove[] = [];
  const o = parts.opp;

  if (isAtRisk(o, today) && isHighValue(o)) {
    moves.push({
      key: `deal-${o.id}`,
      kind: "deal",
      priority: 100,
      title: "Re-engage this at-risk deal",
      detail: "High-value and slipping — log an interaction or refresh the close date to keep it moving.",
    });
  }

  const cooling = parts.awsTeam.filter((r) => r.atStake).sort((a, b) => a.score - b.score);
  const coolRep = cooling[0];
  if (coolRep) {
    moves.push({
      key: `rep-${coolRep.id}`,
      kind: "rep",
      priority: 90,
      title: `Reconnect with ${coolRep.name}`,
      detail: `AWS ${coolRep.role} relationship is cooling (${coolRep.daysSinceContact ?? "no"} days since contact) with pipeline at stake.`,
      link: "/ace?tab=relationships",
    });
  }

  const eu = eligibleUnappliedOf(parts);
  const topFund = eu[0];
  if (topFund) {
    moves.push({
      key: `funding-${topFund.program.key}`,
      kind: "funding",
      priority: 80,
      title: `Apply for ${topFund.program.name}`,
      detail: topFund.rationale,
      link: `/funding/eligibility?opp=${o.id}`,
    });
  }

  if (parts.mdf.length === 0 && o.status === "open") {
    moves.push({
      key: `mdf-${o.id}`,
      kind: "mdf",
      priority: 60,
      title: "Fund a marketing activity for this deal",
      detail: "No MDF is backing this opportunity yet — request co-funding to accelerate it.",
      link: `/mdf?ref=${encodeURIComponent(o.name)}`,
    });
  }

  // Marketplace private-offer bridge: send a drafted offer, or draft one when the
  // listing is live but nothing is in flight yet.
  const draftOffer = parts.offers.find((f) => f.status === "draft");
  const hasOpenOffer = parts.offers.some((f) => f.status === "draft" || f.status === "sent");
  const publishedListing = parts.marketplace.listings.some((l) => l.status === "published");
  if (draftOffer) {
    moves.push({
      key: `offer-send-${draftOffer.id}`,
      kind: "marketplace",
      priority: 55,
      title: "Send the drafted private offer",
      detail: "A private offer is drafted for this deal — send it so it can close on Marketplace.",
      link: `/marketplace/offers?opp=${o.id}`,
    });
  } else if (publishedListing && !hasOpenOffer && parts.marketplace.agreements.length === 0) {
    moves.push({
      key: `mp-${o.id}`,
      kind: "marketplace",
      priority: 50,
      title: "Draft a private offer",
      detail: "The linked listing is published but has no offer yet — draft a private offer to close this on Marketplace.",
      link: `/marketplace/offers?opp=${o.id}`,
    });
  }

  // Customer proof points: suggest pinning when relevant case studies exist but
  // none is attached yet. Collateral, not a lever — ranks below marketplace.
  const hasAttachedStudy = parts.caseStudies.some((cs) => cs.attached);
  if (o.status === "open" && parts.caseStudies.length > 0 && !hasAttachedStudy) {
    const n = parts.caseStudies.length;
    moves.push({
      key: `proof-${o.id}`,
      kind: "proof",
      priority: 40,
      title: "Attach a customer proof point",
      detail: `${n} relevant case ${n === 1 ? "study matches" : "studies match"} this deal — pin one so the team sells with evidence.`,
      link: "#case-studies",
    });
  }

  return moves.sort((a, b) => b.priority - a.priority);
}

export function assembleDealDesk(parts: DealDeskParts, today: string): DealDeskModel {
  return { ...parts, eligibleUnapplied: eligibleUnappliedOf(parts), moves: dealMoves(parts, today) };
}
