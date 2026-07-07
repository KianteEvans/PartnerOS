/**
 * Pure helpers for the per-user "collapse a module / KPI card" preference.
 *
 * State lives in ONE cookie (`partneros_collapsed`) holding the collapsed keys
 * only (expanded = absent). Keys are `${section}:${slug}` so the same-titled
 * panel on two sections stays independent. The server reads the cookie and
 * renders the correct state (flash-free, no hydration hack); the client writes
 * it on toggle. This module is shared by both sides and is dependency-free so it
 * unit-tests cleanly and imports into the client bundle.
 */

export const COLLAPSE_COOKIE = "partneros_collapsed";
export const COLLAPSE_MAX_AGE = 60 * 60 * 24 * 365; // ~1 year

/** Stable, filesystem-safe key fragment from a human title/label. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Route section = first path segment (matches the theme-init convention). */
export function sectionOf(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

/** Fully-qualified collapse key for a slug within a section. */
export function collapseKeyOf(section: string, slug: string): string {
  return `${section}:${slug}`;
}

/** Parse the cookie value (comma-separated keys) into a set. */
export function parseCollapsed(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((k) => k.trim()).filter((k) => k.length > 0));
}

/** Serialize a set back to a cookie value (sorted for stability). */
export function serializeCollapsed(keys: Iterable<string>): string {
  return [...new Set(keys)].filter((k) => k.length > 0).sort().join(",");
}

/** Return a new set with `key` added (collapsed) or removed (expanded). */
export function toggleKey(keys: ReadonlySet<string>, key: string, collapsed: boolean): Set<string> {
  const next = new Set(keys);
  if (collapsed) next.add(key);
  else next.delete(key);
  return next;
}
