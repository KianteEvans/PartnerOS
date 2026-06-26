/**
 * Pure MDF lifecycle state machine. The request moves through funding stages;
 * each transition is gated by an operation, but the ALLOWED transitions and
 * their meaning live here so both the operations and the UI agree.
 *
 *   draft -> requested -> approved -> deployed -> claimed -> reimbursed
 *                      \-> rejected
 */

export type MdfStatus =
  | "draft"
  | "requested"
  | "approved"
  | "rejected"
  | "deployed"
  | "claimed"
  | "reimbursed";

export const MDF_STATUS_LABELS: Record<MdfStatus, string> = {
  draft: "Draft",
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  deployed: "Deployed",
  claimed: "Claimed",
  reimbursed: "Reimbursed",
};

const TRANSITIONS: Record<MdfStatus, readonly MdfStatus[]> = {
  draft: ["requested"],
  requested: ["approved", "rejected"],
  approved: ["deployed"],
  deployed: ["claimed"],
  claimed: ["reimbursed"],
  rejected: [],
  reimbursed: [],
};

export function allowedNext(status: MdfStatus): readonly MdfStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: MdfStatus, to: MdfStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Still in flight (not rejected, not fully reimbursed). */
export function isOpen(status: MdfStatus): boolean {
  return status !== "rejected" && status !== "reimbursed";
}
