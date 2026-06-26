/**
 * Shared parsing + href helpers for server-side list controls (search, sort,
 * pagination). Pure and unit-tested — the list pages read params with
 * `parseListParams`, build the DB query from them, and render links with
 * `listHref`. Keeping this in one place means every paginated table behaves
 * identically (clamping, sort whitelisting, URL shape).
 */
export type SortDir = "asc" | "desc";

export interface ListParams {
  readonly page: number; // 1-based
  readonly pageSize: number;
  readonly offset: number;
  readonly sort: string; // validated against the allowed set
  readonly dir: SortDir;
  readonly q: string; // trimmed search term
}

export const DEFAULT_PAGE_SIZE = 25;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseListParams(
  sp: Record<string, string | string[] | undefined>,
  opts: {
    readonly sortable: readonly string[];
    readonly defaultSort: string;
    readonly defaultDir?: SortDir;
    readonly pageSize?: number;
  },
): ListParams {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Math.floor(Number(first(sp.page))) || 1);
  const sortRaw = first(sp.sort);
  const sort = opts.sortable.includes(sortRaw) ? sortRaw : opts.defaultSort;
  const dirRaw = first(sp.dir);
  const dir: SortDir =
    dirRaw === "asc" || dirRaw === "desc" ? dirRaw : (opts.defaultDir ?? "desc");
  const q = first(sp.q).trim();
  return { page, pageSize, offset: (page - 1) * pageSize, sort, dir, q };
}

/** Build a list URL, dropping empty/undefined params for clean links. */
export function listHref(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Total page count for a row count + page size (always ≥ 1). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
