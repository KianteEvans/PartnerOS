import type { ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/Badge";
import { HEALTH_LABELS, type ConnectorHealth } from "@/domain/settings/connectors";
import { relativeTime } from "@/domain/dates";

/**
 * A compact freshness/health strip for any surface that shows synced-from-AWS data
 * (ACE Pipeline, Sales Org, Marketplace). Presentational only — the caller reads the
 * connection and computes `health` via `connectorHealth(...)`, so this shares the exact
 * band + tone the Settings integrations panel uses. `health` drives the pill; the
 * timestamp uses full epoch-ms for sub-day "4h ago" resolution.
 */
export function SyncStatusStrip({
  health,
  lastSyncedAtMs,
  nowMs,
  rowCount,
  rowNoun = "rows",
  label,
}: {
  readonly health: ConnectorHealth;
  readonly lastSyncedAtMs: number | null;
  readonly nowMs: number;
  readonly rowCount: number;
  readonly rowNoun?: string;
  readonly label?: string;
}): ReactNode {
  const synced = lastSyncedAtMs === null ? "never synced" : `synced ${relativeTime(lastSyncedAtMs, nowMs)}`;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 12,
        color: "var(--muted)",
      }}
    >
      <Badge tone={statusTone(health)}>{HEALTH_LABELS[health]}</Badge>
      {label ? <strong style={{ fontWeight: 600 }}>{label}</strong> : null}
      <span>
        {synced} · {rowCount} {rowNoun}
      </span>
    </div>
  );
}
