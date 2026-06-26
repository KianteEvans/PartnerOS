import { addDays } from "@/domain/dates";

/**
 * Pure Evidence Locker inventory logic: given a flat evidence list and a
 * reference "today", derive the priority-filter views, expiration/renewal state,
 * a completeness indicator, and the fail-closed file readiness. No database, no
 * clock — deterministic and unit-testable.
 */

export type EvidenceView =
  | "all"
  | "missing"
  | "rejected"
  | "expiring_soon"
  | "needs_owner"
  | "ready_for_review";

export const EVIDENCE_VIEWS: readonly EvidenceView[] = [
  "all",
  "missing",
  "rejected",
  "expiring_soon",
  "needs_owner",
  "ready_for_review",
];

export const EVIDENCE_VIEW_LABELS: Record<EvidenceView, string> = {
  all: "All",
  missing: "Missing",
  rejected: "Rejected",
  expiring_soon: "Expiring soon",
  needs_owner: "Needs owner",
  ready_for_review: "Ready for AWS review",
};

type Status = "missing" | "collected" | "in_review" | "approved" | "rejected";
type ScanStatus = "pending" | "clean" | "infected" | "error";

/** Days before expiration that counts as "expiring soon". */
export const EXPIRING_WINDOW_DAYS = 60;

export interface EvidenceLike {
  readonly status: Status;
  readonly ownerUserId: string | null;
  readonly expirationDate: string | null;
  readonly createdAt: Date;
}

// The expiry checks read only `expirationDate`, so they accept any row carrying
// it — a full EvidenceLike or the leaner EvidenceSignal the fit engine projects.
export function isExpired(item: { readonly expirationDate: string | null }, today: string): boolean {
  return item.expirationDate !== null && item.expirationDate < today;
}

export function isExpiringSoon(item: { readonly expirationDate: string | null }, today: string): boolean {
  if (item.expirationDate === null) return false;
  if (item.expirationDate < today) return false; // already expired, not "soon"
  const horizon = addDays(today, EXPIRING_WINDOW_DAYS);
  return item.expirationDate <= horizon;
}

export type RenewalStatus = "none" | "current" | "expiring" | "expired";

export function renewalStatus(item: EvidenceLike, today: string): RenewalStatus {
  if (item.expirationDate === null) return "none";
  if (isExpired(item, today)) return "expired";
  if (isExpiringSoon(item, today)) return "expiring";
  return "current";
}

/** Ready to put in front of AWS: collected/in-review, owned, and not expired. */
export function isReadyForReview(item: EvidenceLike, today: string): boolean {
  return (
    (item.status === "collected" || item.status === "in_review") &&
    item.ownerUserId !== null &&
    !isExpired(item, today)
  );
}

function matchesView(
  item: EvidenceLike,
  view: EvidenceView,
  today: string,
): boolean {
  switch (view) {
    case "all":
      return true;
    case "missing":
      return item.status === "missing";
    case "rejected":
      return item.status === "rejected";
    case "expiring_soon":
      return isExpiringSoon(item, today);
    case "needs_owner":
      return item.ownerUserId === null && item.status !== "missing";
    case "ready_for_review":
      return isReadyForReview(item, today);
  }
}

export interface InventoryContext {
  readonly today: string;
}

export function filterEvidence<T extends EvidenceLike>(
  items: readonly T[],
  view: EvidenceView,
  ctx: InventoryContext,
): T[] {
  return items
    .filter((i) => matchesView(i, view, ctx.today))
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function viewCounts(
  items: readonly EvidenceLike[],
  ctx: InventoryContext,
): Record<EvidenceView, number> {
  const counts = {
    all: 0,
    missing: 0,
    rejected: 0,
    expiring_soon: 0,
    needs_owner: 0,
    ready_for_review: 0,
  } as Record<EvidenceView, number>;
  for (const view of EVIDENCE_VIEWS) {
    counts[view] = items.filter((i) => matchesView(i, view, ctx.today)).length;
  }
  return counts;
}

export interface Completeness {
  readonly total: number;
  readonly approved: number;
  readonly missing: number;
  /** Percent approved of total, 0–100. */
  readonly percent: number;
}

/** A simple completeness indicator: share of evidence that is approved. */
export function completeness(items: readonly EvidenceLike[]): Completeness {
  const total = items.length;
  const approved = items.filter((i) => i.status === "approved").length;
  const missing = items.filter((i) => i.status === "missing").length;
  const percent = total === 0 ? 0 : Math.round((approved / total) * 100);
  return { total, approved, missing, percent };
}

export type FileReadiness = "none" | "scanning" | "ready" | "blocked";

/** Fail-closed mapping of a linked file's scan status to a display readiness. */
export function fileReadiness(scanStatus: ScanStatus | null): FileReadiness {
  if (scanStatus === null) return "none";
  if (scanStatus === "clean") return "ready";
  if (scanStatus === "pending") return "scanning";
  return "blocked"; // infected | error
}
