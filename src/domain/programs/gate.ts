import { addDays } from "@/domain/dates";

/**
 * Pure Program Management logic: the readiness gate, portfolio-view membership,
 * and requirement progress. No database, no clock — the caller passes `today`
 * (YYYY-MM-DD). Deterministic and unit-testable.
 */

export type ProgramStatusValue = "pending" | "submitted" | "active" | "expired";

export type ReadinessGate =
  | "in_progress"
  | "needs_evidence"
  | "submission_blocked"
  | "ready_for_roadmap"
  | "renewal_risk"
  | "participating";

export const GATE_LABELS: Record<ReadinessGate, string> = {
  in_progress: "In progress",
  needs_evidence: "Needs evidence",
  submission_blocked: "Submission blocked",
  ready_for_roadmap: "Ready for roadmap",
  renewal_risk: "Renewal risk",
  participating: "Participating",
};

/** Days before a program's expiration that flags renewal risk. */
export const RENEWAL_WINDOW_DAYS = 90;

export interface RequirementState {
  readonly status: "open" | "met" | "blocked";
  /** Whether the requirement's linked evidence exists and is approved. */
  readonly evidenceApproved: boolean;
}

function withinRenewalWindow(
  expirationDate: string | null,
  today: string,
): boolean {
  if (expirationDate === null) return false;
  if (expirationDate < today) return true; // already past due => definitely risk
  const horizon = addDays(today, RENEWAL_WINDOW_DAYS);
  return expirationDate <= horizon;
}

/** Compute the single most important readiness gate for a program. */
export function computeReadinessGate(
  programStatus: ProgramStatusValue,
  requirements: readonly RequirementState[],
  expirationDate: string | null,
  today: string,
): ReadinessGate {
  if (programStatus === "expired") return "renewal_risk";
  if (programStatus === "active") {
    return withinRenewalWindow(expirationDate, today)
      ? "renewal_risk"
      : "participating";
  }

  // pending or submitted -> evaluate the checklist
  if (requirements.some((r) => r.status === "blocked")) {
    return "submission_blocked";
  }
  const allMet =
    requirements.length > 0 && requirements.every((r) => r.status === "met");
  if (allMet) {
    return requirements.every((r) => r.evidenceApproved)
      ? "ready_for_roadmap"
      : "needs_evidence";
  }
  if (requirements.some((r) => r.status === "met" && !r.evidenceApproved)) {
    return "needs_evidence";
  }
  return "in_progress";
}

export interface RequirementProgress {
  readonly met: number;
  readonly total: number;
}

export function requirementProgress(
  requirements: readonly RequirementState[],
): RequirementProgress {
  return {
    met: requirements.filter((r) => r.status === "met").length,
    total: requirements.length,
  };
}

// ---- Portfolio views -------------------------------------------------------

export type PortfolioView = "all" | "active" | "pending" | "expiring" | "available";

export const PORTFOLIO_VIEWS: readonly PortfolioView[] = [
  "all",
  "active",
  "pending",
  "expiring",
  "available",
];

export const PORTFOLIO_VIEW_LABELS: Record<PortfolioView, string> = {
  all: "All",
  active: "Active",
  pending: "Pending",
  expiring: "Expiring",
  available: "Available",
};

export interface PortfolioProgram {
  readonly status: ProgramStatusValue;
  readonly expirationDate: string | null;
}

export function isExpiring(p: PortfolioProgram, today: string): boolean {
  return p.status === "active" && withinRenewalWindow(p.expirationDate, today);
}

function matchesPortfolio(
  p: PortfolioProgram,
  view: PortfolioView,
  today: string,
): boolean {
  switch (view) {
    case "all":
      return true;
    case "active":
      return p.status === "active";
    case "pending":
      return p.status === "pending" || p.status === "submitted";
    case "expiring":
      return isExpiring(p, today);
    case "available":
      return false; // available = library minus adopted, handled by the caller
  }
}

export function filterPrograms<T extends PortfolioProgram>(
  programs: readonly T[],
  view: PortfolioView,
  today: string,
): T[] {
  return programs.filter((p) => matchesPortfolio(p, view, today));
}

/** Counts for the portfolio tabs (excluding 'available', which the caller adds). */
export function portfolioCounts(
  programs: readonly PortfolioProgram[],
  today: string,
): Record<Exclude<PortfolioView, "available">, number> {
  return {
    all: programs.length,
    active: programs.filter((p) => p.status === "active").length,
    pending: programs.filter(
      (p) => p.status === "pending" || p.status === "submitted",
    ).length,
    expiring: programs.filter((p) => isExpiring(p, today)).length,
  };
}
