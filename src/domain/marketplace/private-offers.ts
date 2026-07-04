/**
 * Pure private-offer lifecycle + reconciliation helpers. A private offer is the
 * partner-side artifact that closes a co-sell opportunity on AWS Marketplace; it
 * carries a generic tracker arc (like a funding submission) and reconciles onto a
 * synced AWS agreement once the customer accepts:
 *
 *   draft -> sent -> accepted | declined | expired
 *          (any non-terminal) -> withdrawn
 *
 * No database, no clock — the caller passes what it reads. Deterministic + unit-testable.
 */

export type PrivateOfferStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn";

export const PRIVATE_OFFER_STATUS_LABELS: Record<PrivateOfferStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

const TRANSITIONS: Record<PrivateOfferStatus, readonly PrivateOfferStatus[]> = {
  draft: ["sent", "withdrawn"],
  sent: ["accepted", "declined", "expired", "withdrawn"],
  accepted: [],
  declined: [],
  expired: [],
  withdrawn: [],
};

export function allowedNext(status: PrivateOfferStatus): readonly PrivateOfferStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: PrivateOfferStatus, to: PrivateOfferStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Still in flight — the offer can still be worked (drafted or awaiting a decision). */
export function isOpen(status: PrivateOfferStatus): boolean {
  return status === "draft" || status === "sent";
}

/** Terminal decision states carry no further transitions. */
export function isTerminal(status: PrivateOfferStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export type StepState = "done" | "current" | "upcoming" | "terminal";

export interface LifecycleStep {
  readonly key: PrivateOfferStatus;
  readonly label: string;
  readonly state: StepState;
}

/** The happy-path stages, in order, for the detail-page stepper. */
const FLOW: readonly PrivateOfferStatus[] = ["draft", "sent", "accepted"];

/**
 * Stepper view of an offer's progress. Off-path terminal outcomes (declined /
 * expired / withdrawn) short-circuit to the stages already passed plus a terminal chip.
 */
export function lifecycleSteps(status: PrivateOfferStatus): LifecycleStep[] {
  if (status === "declined" || status === "expired" || status === "withdrawn") {
    return [
      { key: "draft", label: PRIVATE_OFFER_STATUS_LABELS.draft, state: "done" },
      { key: "sent", label: PRIVATE_OFFER_STATUS_LABELS.sent, state: "done" },
      { key: status, label: PRIVATE_OFFER_STATUS_LABELS[status], state: "terminal" },
    ];
  }
  const idx = FLOW.indexOf(status);
  return FLOW.map((s, i) => ({
    key: s,
    label: PRIVATE_OFFER_STATUS_LABELS[s],
    state: i < idx ? "done" : i === idx ? "current" : "upcoming",
  }));
}

export interface OfferSummaryInput {
  readonly status: PrivateOfferStatus;
  readonly offerValue: number;
}

export interface OfferSummary {
  readonly total: number;
  readonly byStatus: Record<PrivateOfferStatus, number>;
  /** Value of offers still in flight (draft + sent). */
  readonly inFlightValue: number;
  /** Value of offers that closed (accepted). */
  readonly acceptedValue: number;
}

export function offerSummary(offers: readonly OfferSummaryInput[]): OfferSummary {
  const byStatus: Record<PrivateOfferStatus, number> = {
    draft: 0,
    sent: 0,
    accepted: 0,
    declined: 0,
    expired: 0,
    withdrawn: 0,
  };
  let inFlightValue = 0;
  let acceptedValue = 0;
  for (const o of offers) {
    byStatus[o.status] += 1;
    if (o.status === "draft" || o.status === "sent") inFlightValue += o.offerValue;
    if (o.status === "accepted") acceptedValue += o.offerValue;
  }
  return { total: offers.length, byStatus, inFlightValue, acceptedValue };
}

export interface OfferMatchInput {
  readonly customerIdentifier: string;
  readonly listingId: string | null;
}

export interface AgreementMatchCandidate {
  readonly id: string;
  readonly customerIdentifier: string;
  readonly listingId: string | null;
  readonly offerType: string;
}

/**
 * The synced AWS agreement that reconciles a SENT offer. The customer identifier is the
 * key; the listing only disambiguates when BOTH the offer and the agreement name one
 * (synced AWS agreements carry no local listing id, so listing is a tiebreaker, never a
 * gate). Prefers a private-offer agreement when several match. Returns null when nothing
 * matches (the offer stays sent).
 */
export function matchAgreementForOffer(
  offer: OfferMatchInput,
  agreements: readonly AgreementMatchCandidate[],
): AgreementMatchCandidate | null {
  if (!offer.customerIdentifier) return null;
  const candidates = agreements.filter(
    (a) =>
      a.customerIdentifier === offer.customerIdentifier &&
      (offer.listingId === null || a.listingId === null || a.listingId === offer.listingId),
  );
  if (candidates.length === 0) return null;
  return candidates.find((a) => /private/i.test(a.offerType)) ?? candidates[0]!;
}
