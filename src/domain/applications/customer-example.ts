import type { CaseStudyAspect } from "@/domain/case-studies/aspects";
import type { FillTarget } from "@/domain/applications/grid";

/**
 * Tier C3: map a customer-example control (the UCR / PS rows) to the case-study
 * aspect that answers it, and build the per-"Customer Reference #N"-column cell
 * fills from a partner's ORDERED attached case studies. Pure — no DB / codec.
 * Customer-example controls carry a `refLabel` on each FillTarget (one per
 * reference column); practice controls do not.
 */

export function aspectForControl(controlId: string, label: string): CaseStudyAspect | null {
  const t = `${controlId} ${label}`.toLowerCase();
  if (/about the customer|customer overview|who (the )?customer/.test(t)) return "aboutCustomer";
  if (/challenge|\bproblem\b|pain point/.test(t)) return "challenge";
  if (/goal|objective/.test(t)) return "goals";
  if (/outcome|\bresult|impact|business value|benefit/.test(t)) return "outcomes";
  if (/technical solution|solution implement|architecture|\bsolution\b/.test(t)) return "solution";
  return null;
}

export interface ControlForFill {
  readonly sheetName: string;
  readonly controlId: string;
  readonly requirement: string;
  readonly responseTargets: readonly FillTarget[];
}

export interface CaseStudyForFill {
  readonly aboutCustomer: string;
  readonly challenge: string;
  readonly goals: string;
  readonly solution: string;
  readonly outcomes: string;
}

export interface CellFill {
  readonly sheet: string;
  readonly cellAddress: string;
  readonly value: string;
}

/** A customer-example control has per-reference targets (refLabel set). */
export function isCustomerExampleControl(c: ControlForFill): boolean {
  return c.responseTargets.some((t) => t.refLabel !== undefined);
}

/**
 * For each customer-example control, write each ordered case study's mapped aspect
 * into its reference column (+ "Yes" in that column's Met?). The k-th attached case
 * study fills the k-th reference column; controls with no aspect mapping or whose
 * aspect is empty are skipped.
 */
export function buildCustomerExampleFills(
  controls: readonly ControlForFill[],
  caseStudies: readonly CaseStudyForFill[],
): CellFill[] {
  const fills: CellFill[] = [];
  for (const c of controls) {
    if (!isCustomerExampleControl(c)) continue;
    const aspect = aspectForControl(c.controlId, c.requirement);
    if (!aspect) continue;
    const n = Math.min(c.responseTargets.length, caseStudies.length);
    for (let k = 0; k < n; k += 1) {
      const value = caseStudies[k]![aspect].trim();
      if (value === "") continue;
      const target = c.responseTargets[k]!;
      fills.push({ sheet: c.sheetName, cellAddress: target.responseAddress, value });
      fills.push({ sheet: c.sheetName, cellAddress: target.metAddress, value: "Yes" });
    }
  }
  return fills;
}
