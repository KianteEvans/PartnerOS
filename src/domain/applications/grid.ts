/**
 * Types for the pure workbook-detection engine. A sheet is flattened to a `Grid`
 * (string[][]) by the ExcelJS adapter; detection then runs with no library
 * dependency, so it's unit-testable on hand-built fixtures.
 */

/** grid[r][c] is the trimmed display string at 0-based row r, col c; "" if blank. */
export type Grid = readonly (readonly string[])[];

export type SheetKind = "intro" | "practice" | "customer_example" | "unknown";

/** One customer-reference group on a customer-example sheet: that reference's
 *  Met? column and Partner Response column (e.g. C/D, E/F, G/H, I/J). */
export interface ReferenceGroup {
  readonly refLabel?: string;
  readonly metCol: number;
  readonly responseCol: number;
}

/** Result of locating the header row and resolving columns. */
export interface ColumnMap {
  readonly headerRow: number;
  readonly bodyStartRow: number;
  readonly idCol: number;
  readonly requirementCol: number;
  /** Practice sheets: the single Met?/Partner Response pair. */
  readonly practicePair?: { readonly metCol: number; readonly responseCol: number };
  /** Customer-example sheets: one per Customer Reference #N group. */
  readonly referenceGroups: readonly ReferenceGroup[];
  /** "Common Cust Example Reqs": AWS-provided sample answer column — READ-ONLY
   *  context for the AI, never a fill target. */
  readonly exampleResponseCol?: number;
}

/** Where the engine must write one answer (A1 addresses). */
export interface FillTarget {
  readonly refLabel?: string;
  readonly metAddress: string;
  readonly responseAddress: string;
}

/** A single extracted control (one requirement row). */
export interface Control {
  readonly id: string;
  readonly requirement: string;
  readonly section: string | null;
  readonly sheetName: string;
  readonly rowIndex: number;
  readonly exampleResponse?: string;
  readonly responseTargets: readonly FillTarget[];
}

/** Everything detection knows about one parsed sheet. */
export interface DetectedSheet {
  readonly sheetName: string;
  readonly kind: SheetKind;
  readonly columnMap: ColumnMap | null;
  readonly controls: readonly Control[];
}
