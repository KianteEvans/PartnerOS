import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";

/**
 * Shared renderer for the workspace activity / audit-receipt rows that recur on
 * the Home hub, Command Center, and Settings → Activity. One consistent row:
 * an action Badge + the resource type, with the actor and timestamp right-aligned.
 */
export interface ActivityItem {
  readonly action: string;
  readonly resourceType: string;
  readonly actor: string;
  readonly at: Date;
}

export function ActivityList({ items }: { items: readonly ActivityItem[] }): ReactNode {
  if (items.length === 0) {
    return <p style={{ color: "var(--muted)", margin: 0, fontSize: 13 }}>No activity yet.</p>;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.map((a, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "center",
            fontSize: 13,
            borderBottom: "1px solid var(--border)",
            paddingBottom: 5,
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Badge tone="info">{a.action}</Badge>
            <span style={{ color: "var(--muted)" }}>{a.resourceType}</span>
          </span>
          <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
            {a.actor} · {a.at.toISOString().slice(0, 16).replace("T", " ")}
          </span>
        </div>
      ))}
    </div>
  );
}
