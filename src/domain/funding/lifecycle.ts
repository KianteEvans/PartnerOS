/**
 * Pure funding-submission lifecycle state machine. A generic application arc shared by
 * every AWS funding program (the MDF-specific co-fund/claim machinery lives in MDF):
 *
 *   draft -> submitted -> in_review -> approved -> funded
 *                      \-> rejected
 *   (any non-terminal) -> withdrawn
 */

export type FundingSubmissionStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "funded"
  | "withdrawn";

export const FUNDING_STATUS_LABELS: Record<FundingSubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  funded: "Funded",
  withdrawn: "Withdrawn",
};

const TRANSITIONS: Record<FundingSubmissionStatus, readonly FundingSubmissionStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["in_review", "approved", "rejected", "withdrawn"],
  in_review: ["approved", "rejected", "withdrawn"],
  approved: ["funded", "withdrawn"],
  rejected: [],
  funded: [],
  withdrawn: [],
};

export function allowedNext(status: FundingSubmissionStatus): readonly FundingSubmissionStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: FundingSubmissionStatus, to: FundingSubmissionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Still in flight — not a terminal decision. */
export function isOpen(status: FundingSubmissionStatus): boolean {
  return status !== "rejected" && status !== "funded" && status !== "withdrawn";
}

export type StepState = "done" | "current" | "upcoming" | "terminal";

export interface LifecycleStep {
  readonly key: FundingSubmissionStatus;
  readonly label: string;
  readonly state: StepState;
}

/** The happy-path stages, in order, for the detail-page stepper. */
const FLOW: readonly FundingSubmissionStatus[] = ["draft", "submitted", "in_review", "approved", "funded"];

/**
 * Stepper view of a submission's progress. Terminal off-path outcomes (rejected /
 * withdrawn) short-circuit to the stages already passed plus a distinct terminal chip.
 */
export function lifecycleSteps(status: FundingSubmissionStatus): LifecycleStep[] {
  if (status === "rejected") {
    return [
      { key: "draft", label: FUNDING_STATUS_LABELS.draft, state: "done" },
      { key: "submitted", label: FUNDING_STATUS_LABELS.submitted, state: "done" },
      { key: "rejected", label: FUNDING_STATUS_LABELS.rejected, state: "terminal" },
    ];
  }
  if (status === "withdrawn") {
    return [
      { key: "draft", label: FUNDING_STATUS_LABELS.draft, state: "done" },
      { key: "withdrawn", label: FUNDING_STATUS_LABELS.withdrawn, state: "terminal" },
    ];
  }
  const idx = FLOW.indexOf(status);
  return FLOW.map((s, i) => ({
    key: s,
    label: FUNDING_STATUS_LABELS[s],
    state: i < idx ? "done" : i === idx ? "current" : "upcoming",
  }));
}
