"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

/**
 * List | Calendar toggle for the candidate-events panel. Both views are server-
 * rendered and passed in as props; this client wrapper just switches between them.
 * Mirrors the roadmap List/Timeline toggle.
 */
const base: CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  fontSize: 13,
  border: "1px solid var(--border)",
  cursor: "pointer",
  fontWeight: 600,
};

export function PlanViews({ list, calendar }: { list: ReactNode; calendar: ReactNode }): ReactNode {
  const [view, setView] = useState<"list" | "calendar">("list");
  const style = (v: "list" | "calendar"): CSSProperties => ({
    ...base,
    background: view === v ? "var(--section-accent)" : "transparent",
    color: view === v ? "var(--accent-ink)" : "var(--muted)",
  });
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button type="button" onClick={() => setView("list")} style={style("list")}>List</button>
        <button type="button" onClick={() => setView("calendar")} style={style("calendar")}>Calendar</button>
      </div>
      {view === "list" ? list : calendar}
    </div>
  );
}
