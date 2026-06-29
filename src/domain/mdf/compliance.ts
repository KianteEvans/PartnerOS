import { addDays } from "@/domain/dates";
import { activityByKey } from "@/domain/mdf/activity-catalog";

/**
 * Pure AWS MDF compliance engine: co-fund math, derived AWS deadlines, and the
 * eligibility/timing rule checks that gate a planned event (and, at submit, a
 * request). No DB, no clock — the caller passes `today` (YYYY-MM-DD). Grounded in
 * the AWS Partner MDF Program Guide; see `activity-catalog.ts`.
 *
 * Enforcement model (user decision): BLOCK on clear violations, WARN on soft ones.
 */

export interface CoFunding {
  readonly totalCost: number;
  /** AWS's share — the amount requested/claimed from MDF. */
  readonly amountToClaim: number;
  /** The Partner's out-of-pocket remainder. */
  readonly partnerShare: number;
}

/** Split a total activity cost into the AWS ask vs the Partner share (default 50/50). */
export function coFunding(totalCost: number, coFundPct = 50): CoFunding {
  const pct = Math.min(100, Math.max(0, coFundPct));
  const amountToClaim = Math.round((Math.max(0, totalCost) * pct) / 100);
  return { totalCost, amountToClaim, partnerShare: Math.max(0, totalCost - amountToClaim) };
}

const minIso = (a: string, b: string): string => (a < b ? a : b);
const yearOf = (iso: string): string => iso.slice(0, 4);

export interface DerivedDeadlines {
  /** Latest fund-request submission: 14 days before start, capped at Dec 1 of the start year. */
  readonly submitBy: string | null;
  /** Latest claim: 30 days after end, capped at Dec 15 of the end year. */
  readonly claimBy: string | null;
}

export function derivedDeadlines(
  startDate: string | null,
  endDate: string | null,
): DerivedDeadlines {
  return {
    submitBy: startDate ? minIso(addDays(startDate, -14), `${yearOf(startDate)}-12-01`) : null,
    claimBy: endDate ? minIso(addDays(endDate, 30), `${yearOf(endDate)}-12-15`) : null,
  };
}

export interface PlanItemLike {
  readonly catalogKey: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly totalCost: number;
  readonly coFundPct: number;
  readonly brandingConfirmed?: boolean | undefined;
}

export type Severity = "block" | "warn" | "ok";

export interface ComplianceCheck {
  readonly key: string;
  readonly label: string;
  readonly severity: Severity;
  readonly message: string;
}

/** AWS fund-request lead time (days) AWS requires before the activity start. */
export const LEAD_DAYS = 14;

/**
 * Evaluate one planned item against the AWS rules. Returns a full checklist (each
 * rule reports `ok` when satisfied, else `block`/`warn`) so the UI can render
 * positives and negatives alike. Pass `availableMdf` to add a budget-fit check.
 */
export function complianceChecks(
  item: PlanItemLike,
  today: string,
  availableMdf?: number,
): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const activity = activityByKey(item.catalogKey);

  // 1. Eligibility of the chosen activity type.
  if (!activity) {
    checks.push({ key: "eligibility", label: "AWS activity type", severity: "warn", message: "No AWS activity type selected — pick one to confirm eligibility." });
  } else if (activity.eligibility === "ineligible") {
    checks.push({ key: "eligibility", label: "AWS activity type", severity: "block", message: `Ineligible: ${activity.reason ?? "AWS does not fund this activity."}` });
  } else {
    checks.push({ key: "eligibility", label: "AWS activity type", severity: "ok", message: `${activity.label} is an approved MDF activity.` });
  }

  // 2. Dates present + ordered.
  const haveDates = item.startDate !== null && item.endDate !== null;
  if (!haveDates) {
    checks.push({ key: "dates", label: "Activity dates", severity: "block", message: "Activity start and end dates are required." });
  } else if (item.startDate! > item.endDate!) {
    checks.push({ key: "dates", label: "Activity dates", severity: "block", message: "Activity end date is before the start date." });
  } else {
    checks.push({ key: "dates", label: "Activity dates", severity: "ok", message: "Start and end dates set." });

    // 3. No crossing calendar years.
    if (yearOf(item.startDate!) !== yearOf(item.endDate!)) {
      checks.push({ key: "calendar_year", label: "Single calendar year", severity: "block", message: "Activity dates cannot cross calendar years." });
    } else {
      checks.push({ key: "calendar_year", label: "Single calendar year", severity: "ok", message: "Activity stays within one calendar year." });
    }
  }

  // 4. Pre-approval — the activity must not have started yet.
  if (item.startDate) {
    if (item.startDate < today) {
      checks.push({ key: "pre_approval", label: "Pre-approval before start", severity: "block", message: "The activity has already started — AWS requires approval before the start date." });
    } else {
      checks.push({ key: "pre_approval", label: "Pre-approval before start", severity: "ok", message: "Activity has not started yet." });

      // 5. Dec 1 submission cutoff for the start year.
      const cutoff = `${yearOf(item.startDate)}-12-01`;
      if (today > cutoff) {
        checks.push({ key: "submit_cutoff", label: "Dec 1 submission cutoff", severity: "block", message: `Past the December 1 fund-request cutoff for ${yearOf(item.startDate)}.` });
      }

      // 6. 14-day lead time (soft).
      if (addDays(today, LEAD_DAYS) > item.startDate) {
        checks.push({ key: "lead_time", label: "14-day lead time", severity: "warn", message: `Less than ${LEAD_DAYS} days before start — AWS asks for fund requests at least ${LEAD_DAYS} days ahead.` });
      } else {
        checks.push({ key: "lead_time", label: "14-day lead time", severity: "ok", message: `At least ${LEAD_DAYS} days before the activity starts.` });
      }
    }
  }

  // 7. AWS branding (soft).
  if (activity?.eligibility !== "ineligible") {
    checks.push(
      item.brandingConfirmed
        ? { key: "branding", label: "AWS branding", severity: "ok", message: "AWS branding/messaging confirmed." }
        : { key: "branding", label: "AWS branding", severity: "warn", message: "Confirm AWS branding/messaging is included — it's required on every MDF activity." },
    );
  }

  // 8. Budget fit (soft) — only when the available MDF is known.
  if (availableMdf !== undefined) {
    const ask = coFunding(item.totalCost, item.coFundPct).amountToClaim;
    if (ask > availableMdf) {
      checks.push({ key: "budget", label: "Available MDF", severity: "warn", message: `This activity's AWS ask exceeds your available MDF.` });
    }
  }

  return checks;
}

/** True if the item violates any hard (block-severity) AWS rule. */
export function isBlocked(item: PlanItemLike, today: string): boolean {
  return complianceChecks(item, today).some((c) => c.severity === "block");
}

export interface PlanSummary {
  readonly itemCount: number;
  readonly totalCost: number;
  /** Sum of the AWS ask across non-blocked items. */
  readonly eligibleAsk: number;
  readonly availableMdf: number;
  /** availableMdf - eligibleAsk (negative when over). */
  readonly headroom: number;
  readonly over: boolean;
  readonly blockedCount: number;
  readonly warnCount: number;
}

/** Roll a plan's items up against available MDF for the planner header. */
export function planSummary(
  items: readonly PlanItemLike[],
  availableMdf: number,
  today: string,
): PlanSummary {
  let totalCost = 0;
  let eligibleAsk = 0;
  let blockedCount = 0;
  let warnCount = 0;
  for (const item of items) {
    totalCost += item.totalCost;
    const checks = complianceChecks(item, today);
    const blocked = checks.some((c) => c.severity === "block");
    if (blocked) blockedCount += 1;
    else {
      eligibleAsk += coFunding(item.totalCost, item.coFundPct).amountToClaim;
      if (checks.some((c) => c.severity === "warn")) warnCount += 1;
    }
  }
  return {
    itemCount: items.length,
    totalCost,
    eligibleAsk,
    availableMdf,
    headroom: availableMdf - eligibleAsk,
    over: eligibleAsk > availableMdf,
    blockedCount,
    warnCount,
  };
}
