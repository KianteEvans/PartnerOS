"use client";

import type { ReactNode } from "react";

/** Triggers the browser print dialog (Save as PDF) for the print view. */
export function PrintButton(): ReactNode {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        background: "var(--accent)",
        color: "var(--accent-ink)",
        border: "none",
        borderRadius: 8,
        padding: "8px 16px",
        fontWeight: 600,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      Print / Save as PDF
    </button>
  );
}
