import { deadlineRisk, type MdfLike } from "@/domain/mdf/analytics";

/**
 * Pure MDF list-triage logic: given the loaded requests + a reference `today` and
 * the viewer's id, derive membership of each list view, per-view counts, and a
 * stable ordering. No database, no clock — mirrors `src/domain/tasks/views.ts`,
 * so the MDF list filters/sorts in memory over the already-loaded portfolio.
 */

export type MdfView =
  | "all"
  | "mine"
  | "awaiting_approval"
  | "to_claim"
  | "at_risk"
  | "reimbursed"
  | "drafts";

export const MDF_VIEWS: readonly MdfView[] = [
  "all",
  "mine",
  "awaiting_approval",
  "to_claim",
  "at_risk",
  "reimbursed",
  "drafts",
];

export const MDF_VIEW_LABELS: Record<MdfView, string> = {
  all: "All",
  mine: "My requests",
  awaiting_approval: "Awaiting approval",
  to_claim: "To claim",
  at_risk: "At-risk",
  reimbursed: "Reimbursed",
  drafts: "Drafts",
};

export function isMdfView(v: string | undefined): v is MdfView {
  return v !== undefined && (MDF_VIEWS as readonly string[]).includes(v);
}

export type MdfSort = "created" | "title" | "status" | "requested" | "approved" | "deadline";

export interface MdfViewContext {
  readonly userId: string;
  /** Reference date, YYYY-MM-DD. */
  readonly today: string;
}

function matchesView(r: MdfLike, view: MdfView, ctx: MdfViewContext): boolean {
  switch (view) {
    case "all":
      return true;
    case "mine":
      return r.ownerUserId === ctx.userId;
    case "awaiting_approval":
      return r.status === "requested";
    case "to_claim":
      return r.status === "deployed"; // deployed funds not yet claimed
    case "at_risk":
      return deadlineRisk(r, ctx.today);
    case "reimbursed":
      return r.status === "reimbursed";
    case "drafts":
      return r.status === "draft";
  }
}

/** The minimal row shape the list controls need (a superset of MdfLike). */
type ListRow = MdfLike & {
  readonly title: string;
  readonly activityType: string;
  readonly createdAt: Date;
};

export interface MdfFilter {
  readonly view: MdfView;
  /** "all" or one of the activity types. */
  readonly activity: string;
  readonly q: string;
}

/** Filter to a view + activity-type + title search. Pure. */
export function filterRequests<T extends ListRow>(
  rows: readonly T[],
  filter: MdfFilter,
  ctx: MdfViewContext,
): T[] {
  const q = filter.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      matchesView(r, filter.view, ctx) &&
      (filter.activity === "all" || r.activityType === filter.activity) &&
      (q === "" || r.title.toLowerCase().includes(q)),
  );
}

/** Counts per view (over all rows, activity/search-independent) for the pill badges. */
export function viewCounts(
  rows: readonly MdfLike[],
  ctx: MdfViewContext,
): Record<MdfView, number> {
  const counts = {
    all: 0,
    mine: 0,
    awaiting_approval: 0,
    to_claim: 0,
    at_risk: 0,
    reimbursed: 0,
    drafts: 0,
  } as Record<MdfView, number>;
  for (const v of MDF_VIEWS) {
    counts[v] = rows.filter((r) => matchesView(r, v, ctx)).length;
  }
  return counts;
}

/** Sort by a list column; ties break on title. Pure, stable. */
export function sortRequests<T extends ListRow>(
  rows: readonly T[],
  sort: MdfSort,
  dir: "asc" | "desc",
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: T, b: T): number => {
    switch (sort) {
      case "title":
        return sign * a.title.localeCompare(b.title);
      case "status":
        return sign * a.status.localeCompare(b.status);
      case "requested":
        return sign * (a.requestedAmount - b.requestedAmount);
      case "approved":
        return sign * ((a.approvedAmount ?? 0) - (b.approvedAmount ?? 0));
      case "deadline":
        return sign * (a.claimDeadline ?? "9999-99-99").localeCompare(b.claimDeadline ?? "9999-99-99");
      case "created":
      default:
        return sign * (a.createdAt.getTime() - b.createdAt.getTime());
    }
  };
  return [...rows].sort((x, y) => cmp(x, y) || x.title.localeCompare(y.title));
}
