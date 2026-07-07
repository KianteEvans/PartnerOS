import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { COLLAPSE_COOKIE, collapseKeyOf, parseCollapsed, sectionOf, slugify } from "./collapse";

/**
 * Server side of the collapse preference: read the cookie + the middleware-set
 * `x-pathname` header so Panel/MetricCard can render the correct collapsed state
 * during SSR (flash-free). Both reads are `cache()`-wrapped so 60+ panels on one
 * page share a single cookie parse + header read per request.
 */

const getCollapsedSet = cache(async (): Promise<ReadonlySet<string>> => {
  const jar = await cookies();
  return parseCollapsed(jar.get(COLLAPSE_COOKIE)?.value);
});

const getSection = cache(async (): Promise<string> => {
  const h = await headers();
  return sectionOf(h.get("x-pathname") ?? "");
});

export interface CollapseState {
  readonly key: string;
  readonly collapsed: boolean;
}

/**
 * Resolve the section-scoped key for a title/label slug and whether it's
 * currently collapsed. The cookie holds collapsed keys only, so everything
 * defaults to expanded until the user collapses it.
 */
export async function resolveCollapse(slug: string, explicitKey?: string): Promise<CollapseState> {
  const [section, set] = await Promise.all([getSection(), getCollapsedSet()]);
  const key = explicitKey ?? collapseKeyOf(section, slugify(slug));
  return { key, collapsed: set.has(key) };
}
