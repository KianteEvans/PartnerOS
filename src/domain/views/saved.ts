/**
 * Saved-view helpers — pure and unit-tested. A "list key" identifies which list
 * page a preset belongs to; the stored `query` is a normalized URL query string
 * that the page reads back through `parseListParams`. Keeping the registry +
 * query normalization here means every list wires saved views identically.
 */

export interface SavedViewList {
  /** Stable key stored on each row (e.g. "ace:opportunities"). */
  readonly key: string;
  /** The route the saved view links back to. */
  readonly basePath: string;
  /** Human label (unused on-page today; handy for a future cross-list manager). */
  readonly label: string;
}

/** Every list page that supports saved views. Two ACE tabs share /ace. */
export const SAVED_VIEW_LISTS: readonly SavedViewList[] = [
  { key: "tasks", basePath: "/tasks", label: "Tasks" },
  { key: "evidence", basePath: "/evidence", label: "Evidence" },
  { key: "mdf", basePath: "/mdf", label: "MDF" },
  { key: "assessments", basePath: "/assessments", label: "Assessments" },
  { key: "roadmaps", basePath: "/roadmaps", label: "Roadmaps" },
  { key: "reports", basePath: "/reports", label: "Reports" },
  { key: "programs", basePath: "/programs", label: "Programs" },
  { key: "ace:opportunities", basePath: "/ace", label: "ACE opportunities" },
  { key: "ace:relationships", basePath: "/ace", label: "ACE relationships" },
];

const BY_KEY = new Map(SAVED_VIEW_LISTS.map((l) => [l.key, l]));

export function isKnownList(key: string): boolean {
  return BY_KEY.has(key);
}

/**
 * Collapse a params object into a stable query string for storage/compare:
 * sorted keys, empty values dropped, and `page` excluded (a saved view should
 * recall the filter/sort — not pin you to page 3).
 */
export function normalizeViewQuery(
  params: Record<string, string | undefined>,
): string {
  const p = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    if (key === "page") continue;
    const value = params[key];
    if (value !== undefined && value !== "") p.set(key, value);
  }
  return p.toString();
}

/** The href that re-applies a saved view (falls back to "/" for an unknown key). */
export function savedViewHref(listKey: string, query: string): string {
  const base = BY_KEY.get(listKey)?.basePath ?? "/";
  return query ? `${base}?${query}` : base;
}
