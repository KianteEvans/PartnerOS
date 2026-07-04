/**
 * Pure search + sort + pagination for the Listings table. The page loads every
 * listing (the per-tenant set is small) for its hero aggregates, then this
 * shapes the visible page from the shared `ListParams` (q/sort/dir/offset). No
 * DB, no clock — deterministic and unit-testable, mirroring the reports list but
 * in-memory so the RLS loader stays untouched.
 */
import type { ListParams } from "@/domain/list";
import { tableView } from "@/domain/marketplace/table-view";

export interface ListingViewRow {
  readonly title: string;
  readonly productType: string;
  readonly visibility: string;
  readonly status: string;
  readonly dimensionCount: number;
  readonly lastSyncedAt: Date | null;
}

export interface ListingViewResult<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

/** Allowed sort keys for the Listings table (also passed to `parseListParams`). */
export const LISTING_SORT_KEYS = ["title", "type", "status", "visibility", "dims", "synced"] as const;

const byTitle = (a: ListingViewRow, b: ListingViewRow): number => a.title.localeCompare(b.title);

const COMPARATORS: Record<string, (a: ListingViewRow, b: ListingViewRow) => number> = {
  title: byTitle,
  type: (a, b) => a.productType.localeCompare(b.productType) || byTitle(a, b),
  status: (a, b) => a.status.localeCompare(b.status) || byTitle(a, b),
  visibility: (a, b) => a.visibility.localeCompare(b.visibility) || byTitle(a, b),
  dims: (a, b) => a.dimensionCount - b.dimensionCount || byTitle(a, b),
  synced: (a, b) => (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0) || byTitle(a, b),
};

/** Filter by title substring, sort by the chosen key/dir, then slice to the page. */
export function listingView<T extends ListingViewRow>(
  listings: readonly T[],
  params: Pick<ListParams, "q" | "sort" | "dir" | "offset" | "pageSize">,
): ListingViewResult<T> {
  return tableView(listings, params, { search: (l) => l.title, comparators: COMPARATORS });
}
