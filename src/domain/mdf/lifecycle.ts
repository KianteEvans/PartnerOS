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

export type StepState = "done" | "current" | "upcoming" | "rejected";

export interface LifecycleStep {
  readonly key: MdfStatus;
  readonly label: string;
  readonly state: StepState;
}

/** The happy-path funding stages, in order, for the detail-page stepper. */
const FLOW: readonly MdfStatus[] = [
  "draft",
  "requested",
  "approved",
  "deployed",
  "claimed",
  "reimbursed",
];

/**
 * The stepper view of a request's progress: each happy-path stage tagged
 * done/current/upcoming. A rejected request short-circuits to draft+requested
 * (done) followed by a distinct terminal `rejected` chip.
 */
export function lifecycleSteps(status: MdfStatus): LifecycleStep[] {
  if (status === "rejected") {
    return [
      { key: "draft", label: MDF_STATUS_LABELS.draft, state: "done" },
      { key: "requested", label: MDF_STATUS_LABELS.requested, state: "done" },
      { key: "rejected", label: MDF_STATUS_LABELS.rejected, state: "rejected" },
    ];
  }
  const idx = FLOW.indexOf(status);
  return FLOW.map((s, i) => ({
    key: s,
    label: MDF_STATUS_LABELS[s],
    state: i < idx ? "done" : i === idx ? "current" : "upcoming",
  }));
}
