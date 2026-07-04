import { connectorHealth } from "@/domain/settings/connectors";
import type { Decision } from "@/domain/command/brief";

/**
 * Pure AWS-sync decision signals for the Command Center + notification bell. Two
 * cross-section "needs attention" items derived from the Partner Central connection:
 * a **stale sync** (configured but not synced within the freshness window) and data
 * **drift** (local opportunities that disagree with the read-only AWS mirror). The
 * loader does the DB work + drift count; this stays clock-injected and unit-testable.
 */
export interface AwsSyncInput {
  /** aws_connection.status: not_configured | configured | disabled | error. */
  readonly status: string;
  /** ISO date (YYYY-MM-DD) of the last successful sync, or null if never. */
  readonly lastSyncDate: string | null;
  /** Local opportunities that differ from their Partner Central mirror row. */
  readonly driftCount: number;
}

export function awsSyncDecisions(input: AwsSyncInput | undefined, today: string): Decision[] {
  if (!input) return [];
  const out: Decision[] = [];

  // Stale: only nag once the connection is actually configured — disabled/error/
  // unconfigured states surface via the Settings connector panel, not the queue.
  if (input.status === "configured") {
    const health = connectorHealth({ status: "configured", lastSyncDate: input.lastSyncDate }, today);
    if (health === "stale") {
      out.push({
        id: "aws-sync-stale",
        severity: "medium",
        situation: "aws_sync_stale",
        title: "Partner Central sync is stale",
        detail: input.lastSyncDate
          ? `Last synced ${input.lastSyncDate} — re-sync to pull the latest co-sell opportunities from AWS.`
          : "No successful sync yet — run a sync to pull co-sell opportunities from AWS.",
        ownerUserId: null,
        dueDate: null,
        link: "/ace?tab=reconcile",
      });
    }
  }

  // Drift: the mirror disagrees with local ACE — reconcile so the pipeline is trustworthy.
  if (input.driftCount > 0) {
    out.push({
      id: "aws-sync-drift",
      severity: "medium",
      situation: "aws_sync_drift",
      title: "Opportunities differ from Partner Central",
      detail: `${input.driftCount} opportunit${input.driftCount === 1 ? "y differs" : "ies differ"} from AWS — review and accept the AWS values.`,
      ownerUserId: null,
      dueDate: null,
      link: "/ace?tab=reconcile",
    });
  }

  return out;
}
