import type { ReactNode } from "react";

/**
 * Persistent strip shown while an agency operator is acting inside a managed
 * workspace (Bet C). "Exit to portfolio" posts to the exit route, which re-mints
 * the operator's ordinary session. A plain form so it works without client JS.
 */
export function ActingAsBanner({
  workspaceName,
  agencyName,
}: {
  workspaceName: string;
  agencyName: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        background: "color-mix(in srgb, var(--accent) 13%, var(--panel))",
        borderBottom: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
        padding: "8px 16px",
        fontSize: 13,
      }}
    >
      <span>
        Acting as <strong>{workspaceName}</strong>{" "}
        <span style={{ color: "var(--muted)" }}>· via {agencyName}</span>
      </span>
      <form method="post" action="/api/portfolio/exit" style={{ margin: 0 }}>
        <button
          type="submit"
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--accent)",
            background: "transparent",
            border: "1px solid color-mix(in srgb, var(--accent) 42%, transparent)",
            borderRadius: 999,
            padding: "3px 12px",
            cursor: "pointer",
          }}
        >
          Exit to portfolio →
        </button>
      </form>
    </div>
  );
}
