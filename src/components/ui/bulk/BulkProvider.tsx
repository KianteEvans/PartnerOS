"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Client selection state shared between per-row checkboxes and the floating
 * action bar. The server page passes `allIds` (the ids on the current page) so
 * "select all" and the count work without the bar knowing about the rows. A new
 * page render (filter/search/sort change navigates) remounts this and clears the
 * selection — selecting across filter changes would be a footgun.
 */
interface BulkContext {
  readonly selected: ReadonlySet<string>;
  readonly allIds: readonly string[];
  toggle: (id: string) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
}

const Ctx = createContext<BulkContext | null>(null);

export function useBulk(): BulkContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBulk must be used within <BulkProvider>");
  return c;
}

export function BulkProvider({
  allIds,
  children,
}: {
  allIds: readonly string[];
  children: ReactNode;
}): ReactNode {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback(
    (on: boolean) => setSelected(on ? new Set(allIds) : new Set()),
    [allIds],
  );

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, allIds, toggle, setAll, clear }),
    [selected, allIds, toggle, setAll, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
