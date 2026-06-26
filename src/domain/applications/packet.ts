/**
 * Pure model for the AWS application "submission packet": the real AWS application
 * status lifecycle (partner-maintained) + a readiness Tracker mirroring the guide's
 * Tracker (self-assessment progress, designation categories, point of contact, and
 * the Solution / Case Studies that AWS attaches in Partner Central). No DB/clock.
 */

export type AwsStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "tech_validation_requested"
  | "tech_validation_scheduled"
  | "tech_validation_in_process"
  | "confirmed"
  | "declined"
  | "expired"
  | "pending_partner_action"
  | "marketing_update"
  | "resubmitted"
  | "deleted";

export interface AwsStatusInfo {
  readonly key: AwsStatus;
  readonly label: string;
  /** Whether AWS allows the application to be edited in this status (guide). */
  readonly editable: boolean;
}

export const AWS_STATUSES: readonly AwsStatusInfo[] = [
  { key: "draft", label: "Draft", editable: true },
  { key: "submitted", label: "Submitted", editable: true },
  { key: "in_review", label: "In Review", editable: false },
  { key: "tech_validation_requested", label: "Technical Validation Requested", editable: false },
  { key: "tech_validation_scheduled", label: "Technical Validation Scheduled", editable: false },
  { key: "tech_validation_in_process", label: "Technical Validation In Process", editable: false },
  { key: "confirmed", label: "Confirmed", editable: false },
  { key: "declined", label: "Declined", editable: false },
  { key: "expired", label: "Expired", editable: true },
  { key: "pending_partner_action", label: "Pending Partner Action", editable: true },
  { key: "marketing_update", label: "Marketing Update", editable: false },
  { key: "resubmitted", label: "Resubmitted", editable: true },
  { key: "deleted", label: "Deleted", editable: false },
];

const BY_KEY: ReadonlyMap<string, AwsStatusInfo> = new Map(AWS_STATUSES.map((s) => [s.key, s]));

export function awsStatusLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export function isAwsStatusEditable(key: string): boolean {
  return BY_KEY.get(key)?.editable ?? false;
}

export function isAwsStatus(key: string): key is AwsStatus {
  return BY_KEY.has(key);
}

export interface ReadinessInput {
  readonly controlCount: number;
  readonly acceptedCount: number;
  readonly categories: string;
  readonly pocName: string;
  readonly pocEmail: string;
  readonly caseStudyCount: number;
  /** A validated Solution (Tier D) is linked to this application. */
  readonly solutionAttached: boolean;
}

export type ReadinessState = "met" | "gap" | "confirm";

export interface ReadinessItem {
  readonly label: string;
  readonly state: ReadinessState;
  readonly detail: string;
}

export interface Readiness {
  readonly items: readonly ReadinessItem[];
  /** Self-assessment acceptance, 0-100. */
  readonly responsePercent: number;
  /** Trackable items (excludes the advisory "confirm" rows) that are met. */
  readonly metCount: number;
  readonly trackableCount: number;
}

/**
 * Completeness of the submission packet. Self-assessment / categories / POC /
 * Solution / Case Studies are all checked deterministically now that Tier C
 * (case studies) and Tier D (Solutions) model them.
 */
export function applicationReadiness(input: ReadinessInput): Readiness {
  const responsePercent =
    input.controlCount > 0 ? Math.round((input.acceptedCount / input.controlCount) * 100) : 0;
  const categories = input.categories.trim();
  const pocName = input.pocName.trim();
  const pocEmail = input.pocEmail.trim();
  const pocSet = pocName !== "" && pocEmail !== "";

  const items: ReadinessItem[] = [
    {
      label: "Self-assessment responses",
      state: input.controlCount > 0 && input.acceptedCount >= input.controlCount ? "met" : "gap",
      detail: `${input.acceptedCount}/${input.controlCount} controls accepted (${responsePercent}%).`,
    },
    {
      label: "Designation categories",
      state: categories !== "" ? "met" : "gap",
      detail: categories !== "" ? categories : "Select the categories that fit your Solution.",
    },
    {
      label: "Point of contact",
      state: pocSet ? "met" : "gap",
      detail: pocSet ? `${pocName} (${pocEmail})` : "Designate who AWS can contact about this application.",
    },
    {
      label: "Solution attached",
      state: input.solutionAttached ? "met" : "gap",
      detail: input.solutionAttached
        ? "A validated Solution is linked to this application."
        : "Link the validated Solution that this Specialization covers.",
    },
    {
      label: "Customer case studies",
      state: input.caseStudyCount > 0 ? "met" : "gap",
      detail:
        input.caseStudyCount > 0
          ? `${input.caseStudyCount} case ${input.caseStudyCount === 1 ? "study" : "studies"} on file.`
          : "Create customer case studies to support the application.",
    },
  ];

  const trackable = items.filter((i) => i.state !== "confirm");
  return {
    items,
    responsePercent,
    metCount: trackable.filter((i) => i.state === "met").length,
    trackableCount: trackable.length,
  };
}
