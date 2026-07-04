import type { CapabilityDecision } from "@/domain/settings/automation";

/**
 * Pure run-status machine. A materialized run starts in one of three states from
 * its verdict; `auto` runs are dispatched immediately (the op flips them to
 * executed or failed), `approval` runs wait for a human, `recommend` runs are
 * surfaced only. Terminal: executed / failed / dismissed.
 */

export type RunStatus = "recommended" | "pending_approval" | "executed" | "failed" | "dismissed";

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  recommended: "Recommended",
  pending_approval: "Needs approval",
  executed: "Executed",
  failed: "Failed",
  dismissed: "Dismissed",
};

/** The status a fresh run is persisted with, before an `auto` dispatch resolves it. */
export function initialStatusFor(verdict: CapabilityDecision): RunStatus {
  if (verdict === "approval") return "pending_approval";
  if (verdict === "recommend") return "recommended";
  return "executed"; // auto — optimistic; dispatch downgrades to "failed" on error
}

/** Whether the run is still actionable (awaiting a human) rather than terminal. */
export function isRunOpen(status: RunStatus): boolean {
  return status === "recommended" || status === "pending_approval";
}

/** Only a run awaiting approval can be approved into execution. */
export function canApprove(status: RunStatus): boolean {
  return status === "pending_approval";
}

/** Any open run can be dismissed. */
export function canDismiss(status: RunStatus): boolean {
  return isRunOpen(status);
}
