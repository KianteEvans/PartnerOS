/**
 * Pure search + sort + pagination over an in-memory row set, shared app-wide. A page loads
 * its (small, per-tenant) rows in full, then shapes the visible page from the shared
 * `ListParams` (q/sort/dir/offset) — keeping the RLS loaders untouched. Each caller supplies
 * a `search` accessor + a keyed comparator map. Deterministic and unit-testable. (Originated
 * in the Marketplace section as `tableView`; lifted here for cross-section reuse.)
 */
import type { ListParams } from "@/domain/list";

export interface TableViewResult<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

export interface TableViewOptions<T> {
  /** Text to match the (lower-cased) search query against. Return "" to never match. */
  readonly search: (row: T) => string;
  /** Comparators by sort key; an unknown key falls back to the first entry. */
  readonly comparators: Readonly<Record<string, (a: T, b: T) => number>>;
}

const noop = (): number => 0;

/** Filter by search substring, sort by the chosen key/dir, then slice to the page. */
export function tableView<T>(
  rows: readonly T[],
  params: Pick<ListParams, "q" | "sort" | "dir" | "offset" | "pageSize">,
  opts: TableViewOptions<T>,
): TableViewResult<T> {
  const q = params.q.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => opts.search(r).toLowerCase().includes(q)) : rows.slice();
  const firstKey = Object.keys(opts.comparators)[0] ?? "";
  const cmp = opts.comparators[params.sort] ?? opts.comparators[firstKey] ?? noop;
  const sorted = [...filtered].sort((a, b) => (params.dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  return { rows: sorted.slice(params.offset, params.offset + params.pageSize), total: filtered.length };
}
