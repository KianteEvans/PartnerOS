/**
 * Shared constants + validation for the Competency Application slice.
 */

/** Matches the next.config serverActions.bodySizeLimit ("12mb"). */
export const MAX_WORKBOOK_BYTES = 12 * 1024 * 1024;

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type MetSuggestion = "unknown" | "yes" | "no" | "partial";
export const MET_VALUES: readonly MetSuggestion[] = ["unknown", "yes", "no", "partial"];

export function isMet(v: string): v is MetSuggestion {
  return (MET_VALUES as readonly string[]).includes(v);
}
