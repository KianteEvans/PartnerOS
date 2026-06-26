"use client";

import type { ReactNode } from "react";
import { useBulk } from "@/components/ui/bulk/BulkProvider";

const ghostBtn = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "5px 10px",
  fontSize: 13,
  color: "var(--text)",
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;

/**
 * Sticky action bar that appears only when ≥1 row is selected. Renders the count,
 * a select-all toggle, the list-specific action controls (passed as children),
 * and a clear button. Sticks to the bottom of the viewport so it stays reachable
 * while scrolling a long list.
 */
export function BulkBar({ children }: { children: ReactNode }): ReactNode {
  const { selected, allIds, setAll, clear } = useBulk();
  const count = selected.size;
  if (count === 0) return null;
  const allSelected = count >= allIds.length;

  return (
    <div
      className="pos-bulkbar"
      style={{
        position: "sticky",
        bottom: 12,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "var(--shadow-lift)",
        padding: "10px 14px",
        marginTop: 8,
      }}
    >
      <strong style={{ fontSize: 13, whiteSpace: "nowrap" }}>{count} selected</strong>
      <button type="button" onClick={() => setAll(!allSelected)} style={ghostBtn}>
        {allSelected ? "Deselect all" : `Select all ${allIds.length}`}
      </button>
      <span style={{ width: 1, height: 22, background: "var(--border)" }} aria-hidden="true" />
      {children}
      <button type="button" onClick={clear} style={{ ...ghostBtn, marginLeft: "auto" }}>
        Clear
      </button>
    </div>
  );
}
