"use client";

import type { ReactNode } from "react";
import { useBulk } from "@/components/ui/bulk/BulkProvider";

/** Per-row selection checkbox, bound to the shared BulkProvider state. */
export function BulkCheckbox({ id }: { id: string }): ReactNode {
  const { selected, toggle } = useBulk();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label="Select row"
      style={{ marginTop: 3, cursor: "pointer" }}
    />
  );
}
