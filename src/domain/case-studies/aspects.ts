/**
 * The five customer-example narrative aspects of an AWS case study (mirroring the
 * UCR / PS rows of the customer-example workbook sheets). Pure definitions + a
 * completeness helper. No DB.
 */

export type CaseStudyAspect = "aboutCustomer" | "challenge" | "goals" | "solution" | "outcomes";

export interface AspectInfo {
  readonly key: CaseStudyAspect;
  readonly label: string;
  readonly hint: string;
}

export const CASE_STUDY_ASPECTS: readonly AspectInfo[] = [
  { key: "aboutCustomer", label: "About the customer", hint: "Who the customer is - industry, size, and situation." },
  { key: "challenge", label: "Key business challenge", hint: "The critical problem the customer needed to solve." },
  { key: "goals", label: "Goals & objectives", hint: "What success looked like, working backwards from outcomes." },
  { key: "solution", label: "Technical solution", hint: "How the solution was implemented on AWS to address the challenge." },
  { key: "outcomes", label: "Outcomes & results", hint: "The measurable results and business impact delivered." },
];

export interface CaseStudyAspects {
  readonly aboutCustomer: string;
  readonly challenge: string;
  readonly goals: string;
  readonly solution: string;
  readonly outcomes: string;
}

export interface Completeness {
  readonly filled: number;
  readonly total: number;
  readonly percent: number;
}

/** How many of the five narrative aspects are filled in. */
export function caseStudyCompleteness(cs: CaseStudyAspects): Completeness {
  const total = CASE_STUDY_ASPECTS.length;
  const filled = CASE_STUDY_ASPECTS.filter((a) => cs[a.key].trim() !== "").length;
  return { filled, total, percent: Math.round((filled / total) * 100) };
}
