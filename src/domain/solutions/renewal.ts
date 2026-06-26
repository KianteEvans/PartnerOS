import { TIER_ORDER, type TierId } from "@/domain/tiers/catalog";

/**
 * Pure AWS Specialization renewal-readiness. Continuous-compliance (gap-based):
 * a Solution stays renewal-ready when it is Active, the partner tier is maintained,
 * an approved FTR exists (software path), and enough LAUNCHED ACE opportunities are
 * attached over a rolling 12 months (the 2026 rule). No DB/clock — `today` is a
 * parameter. Mirrors rep-intelligence.ts; the launched count is computed by the
 * loader (a 12-month SQL window) and passed in.
 */

export type RenewalBand = "compliant" | "at_risk" | "non_compliant";

export const RENEWAL_BAND_LABELS: Record<RenewalBand, string> = {
  compliant: "Renewal-ready",
  at_risk: "At risk",
  non_compliant: "Not compliant",
};

/** Launched ACE opportunities AWS expects over the rolling 12 months (2026 rule). */
export const LAUNCHED_OPP_TARGET = 1;
/** Days before a partner-entered renewal date that counts as "due soon". */
export const RENEWAL_WINDOW_DAYS = 90;

export interface RenewalInput {
  readonly availability: string; // "available" => Active
  readonly programType: string;
  readonly solutionType: string;
  readonly ftrStatus: string; // "approved"
  readonly currentTier: TierId;
  readonly launchedCount: number; // launched opps attached, rolling 12mo
  readonly renewalDate: string | null;
}

export interface RenewalCriterion {
  readonly key: "active" | "tier" | "ftr" | "launched";
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RenewalStatus {
  readonly band: RenewalBand;
  readonly criteria: readonly RenewalCriterion[];
  readonly gapCount: number;
  readonly dueInDays: number | null; // from renewalDate; negative = overdue
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Minimum partner tier to MAINTAIN a Specialization (mirrors A3 prerequisites). */
export function requiredTier(programType: string): TierId | null {
  const p = norm(programType);
  if (p === "competency" || p === "msp") return "advanced";
  if (p === "service delivery" || p === "specialization") return "select";
  return null; // Service Ready / FTR / unknown -> no tier requirement
}

function dayCount(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function renewalReadiness(input: RenewalInput, today: string): RenewalStatus {
  const criteria: RenewalCriterion[] = [];

  // 1. Active (Solution agrees to surface on discovery tools).
  const active = norm(input.availability) === "available";
  criteria.push({
    key: "active",
    label: "Solution is Active",
    ok: active,
    detail: active
      ? "Available on AWS discovery tools."
      : `Availability is "${input.availability}" — set it to Available.`,
  });

  // 2. Partner tier maintained.
  const req = requiredTier(input.programType);
  const tierOk = req === null || TIER_ORDER.indexOf(input.currentTier) >= TIER_ORDER.indexOf(req);
  criteria.push({
    key: "tier",
    label: "Partner tier maintained",
    ok: tierOk,
    detail: req === null ? "No tier requirement." : tierOk ? "Tier requirement met." : `Requires ${req} tier or higher.`,
  });

  // 3. Approved FTR (software path only).
  const needsFtr = norm(input.solutionType) === "software_product" || norm(input.programType) === "service ready";
  const ftrOk = !needsFtr || norm(input.ftrStatus) === "approved";
  criteria.push({
    key: "ftr",
    label: "Approved FTR",
    ok: ftrOk,
    detail: !needsFtr ? "Not required (services path)." : ftrOk ? "FTR is approved." : "Software solutions need an approved FTR.",
  });

  // 4. Launched ACE opportunities over the rolling 12 months.
  const launchedOk = input.launchedCount >= LAUNCHED_OPP_TARGET;
  criteria.push({
    key: "launched",
    label: "Launched ACE opportunities (12mo)",
    ok: launchedOk,
    detail: `${input.launchedCount} launched in the last 12 months${
      launchedOk ? "." : ` — AWS expects at least ${LAUNCHED_OPP_TARGET}.`
    }`,
  });

  const gapCount = criteria.filter((c) => !c.ok).length;
  let band: RenewalBand = gapCount === 0 ? "compliant" : gapCount === 1 ? "at_risk" : "non_compliant";

  const dueInDays = input.renewalDate === null ? null : dayCount(today, input.renewalDate);
  // A near or overdue renewal date escalates an otherwise-compliant solution.
  if (band === "compliant" && dueInDays !== null && dueInDays <= RENEWAL_WINDOW_DAYS) band = "at_risk";

  return { band, criteria, gapCount, dueInDays };
}

export interface RenewalSummary {
  readonly total: number;
  readonly atRisk: number;
  readonly nonCompliant: number;
}

export function renewalSummary(statuses: readonly RenewalStatus[]): RenewalSummary {
  return {
    total: statuses.length,
    atRisk: statuses.filter((s) => s.band === "at_risk").length,
    nonCompliant: statuses.filter((s) => s.band === "non_compliant").length,
  };
}
