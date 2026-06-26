import { toA1 } from "@/domain/applications/cells";
import type {
  Grid,
  SheetKind,
  ColumnMap,
  ReferenceGroup,
  FillTarget,
  Control,
  DetectedSheet,
} from "@/domain/applications/grid";

/**
 * Pure, structure-driven detection of AWS Competency Self-Assessment workbooks.
 * Operates on plain string[][] grids — NO ExcelJS import — so it's unit-tested on
 * fixtures. Every AWS competency shares the template family: a header row
 * `ID | Requirement Description | Met? | Partner Response` (practice sheets) or
 * `ID | Requirement Description | Customer Reference #N ...` with a Met?/Response
 * sub-header (customer-example sheets), control rows keyed `PREFIX-NNN`, and
 * section-header rows between them.
 */

/** ^[A-Z]{2,}-\d+$ — GEN-001, IDAM-002, POV-001, GENAIPR-003, EXMUC-001, UCR-001, PS-001. */
export const CONTROL_ID_RE = /^[A-Z]{2,}-\d+$/;

/** Header labels, compared case-insensitively / whitespace-collapsed (stored lowercased). */
export const LABELS = {
  id: ["id"],
  requirement: ["requirement description", "requirement"],
  met: ["met?", "met"],
  response: ["partner response"],
  exampleResponse: ["example response"],
  reference: ["customer reference"], // prefix match -> "Customer Reference #1"
} as const;

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
const cell = (grid: Grid, r: number, c: number): string => (grid[r]?.[c] ?? "").trim();

/**
 * Locate the header row + resolve columns. A row qualifies as the header iff it
 * holds an `id` label AND a `requirement description` label. Returns null when none
 * qualifies (caller skips the sheet). For customer-example sheets, Met?/Response
 * columns come from the sub-header row below and bodyStartRow skips it.
 */
export function findHeader(grid: Grid, opts?: { readonly maxScanRows?: number }): ColumnMap | null {
  const maxScan = Math.min(opts?.maxScanRows ?? 25, grid.length);
  for (let r = 0; r < maxScan; r += 1) {
    const row = grid[r] ?? [];
    let idCol = -1;
    let requirementCol = -1;
    for (let c = 0; c < row.length; c += 1) {
      const v = norm(row[c] ?? "");
      if (idCol === -1 && (LABELS.id as readonly string[]).includes(v)) idCol = c;
      if (requirementCol === -1 && (LABELS.requirement as readonly string[]).includes(v)) requirementCol = c;
    }
    if (idCol === -1 || requirementCol === -1) continue;

    let metCol = -1;
    let responseCol = -1;
    let exampleResponseCol: number | undefined;
    const referenceAnchors: Array<{ readonly col: number; readonly label: string }> = [];
    for (let c = 0; c < row.length; c += 1) {
      const raw = (row[c] ?? "").trim();
      const v = norm(raw);
      if (v === "") continue;
      if ((LABELS.exampleResponse as readonly string[]).includes(v)) exampleResponseCol = c;
      else if (v.startsWith(LABELS.reference[0])) referenceAnchors.push({ col: c, label: raw });
      else if (metCol === -1 && (LABELS.met as readonly string[]).includes(v)) metCol = c;
      else if (responseCol === -1 && (LABELS.response as readonly string[]).includes(v)) responseCol = c;
    }

    if (referenceAnchors.length > 0) {
      const sub = grid[r + 1] ?? [];
      const referenceGroups: ReferenceGroup[] = referenceAnchors.map((a) => {
        // Default layout: Met? at the anchor col, Partner Response at anchor+1.
        // Swap if the sub-header says otherwise (defensive).
        let metC = a.col;
        let respC = a.col + 1;
        const s0 = norm(sub[a.col] ?? "");
        const s1 = norm(sub[a.col + 1] ?? "");
        if ((LABELS.response as readonly string[]).includes(s0) && (LABELS.met as readonly string[]).includes(s1)) {
          metC = a.col + 1;
          respC = a.col;
        }
        return { refLabel: a.label, metCol: metC, responseCol: respC };
      });
      return {
        headerRow: r,
        bodyStartRow: r + 2,
        idCol,
        requirementCol,
        referenceGroups,
        ...(exampleResponseCol !== undefined ? { exampleResponseCol } : {}),
      };
    }

    return {
      headerRow: r,
      bodyStartRow: r + 1,
      idCol,
      requirementCol,
      referenceGroups: [],
      ...(metCol !== -1 && responseCol !== -1 ? { practicePair: { metCol, responseCol } } : {}),
      ...(exampleResponseCol !== undefined ? { exampleResponseCol } : {}),
    };
  }
  return null;
}

/** Classify a sheet by its header. No header + no control-ID rows -> intro. */
export function classifySheet(grid: Grid): SheetKind {
  const cm = findHeader(grid);
  if (cm) return cm.referenceGroups.length > 0 ? "customer_example" : "practice";
  const hasControlRows = grid.some((row) =>
    (row ?? []).some((c) => CONTROL_ID_RE.test((c ?? "").trim().toUpperCase())),
  );
  return hasControlRows ? "unknown" : "intro";
}

/**
 * Walk body rows: a CONTROL row (col idCol matches CONTROL_ID_RE) emits a Control
 * with its responseTargets (1 for practice, N for customer-example); a SECTION row
 * (col idCol non-empty, not an ID, col requirementCol empty) sets the current
 * section carried onto following controls.
 */
export function extractControls(grid: Grid, columnMap: ColumnMap, sheetName: string): Control[] {
  const out: Control[] = [];
  let currentSection: string | null = null;
  for (let r = columnMap.bodyStartRow; r < grid.length; r += 1) {
    const idRaw = cell(grid, r, columnMap.idCol);
    const reqRaw = cell(grid, r, columnMap.requirementCol);
    if (idRaw === "") continue;

    if (CONTROL_ID_RE.test(idRaw.toUpperCase())) {
      const responseTargets: FillTarget[] = columnMap.practicePair
        ? [
            {
              metAddress: toA1(r, columnMap.practicePair.metCol),
              responseAddress: toA1(r, columnMap.practicePair.responseCol),
            },
          ]
        : columnMap.referenceGroups.map((g) => ({
            ...(g.refLabel !== undefined ? { refLabel: g.refLabel } : {}),
            metAddress: toA1(r, g.metCol),
            responseAddress: toA1(r, g.responseCol),
          }));
      const example =
        columnMap.exampleResponseCol !== undefined
          ? cell(grid, r, columnMap.exampleResponseCol)
          : "";
      out.push({
        id: idRaw,
        requirement: reqRaw,
        section: currentSection,
        sheetName,
        rowIndex: r,
        responseTargets,
        ...(example !== "" ? { exampleResponse: example } : {}),
      });
    } else if (reqRaw === "") {
      // Section header row (label in the ID column, no requirement).
      currentSection = idRaw;
    }
  }
  return out;
}

/** classify + findHeader + extractControls for one sheet. Never throws. */
export function detectSheet(grid: Grid, sheetName: string): DetectedSheet {
  const columnMap = findHeader(grid);
  if (!columnMap) {
    const hasControls = grid.some((row) =>
      (row ?? []).some((c) => CONTROL_ID_RE.test((c ?? "").trim().toUpperCase())),
    );
    return { sheetName, kind: hasControls ? "unknown" : "intro", columnMap: null, controls: [] };
  }
  const kind: SheetKind = columnMap.referenceGroups.length > 0 ? "customer_example" : "practice";
  return { sheetName, kind, columnMap, controls: extractControls(grid, columnMap, sheetName) };
}

/** Normalize an AI/boolean Met? decision to the dropdown's exact domain. */
export function toMetValue(v: boolean | string): "Yes" | "No" {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = v.trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "met" ? "Yes" : "No";
}

export type ProgramType =
  | "Competency"
  | "Service Delivery"
  | "Service Ready"
  | "MSP"
  | "FTR"
  | "Unknown";

/**
 * Identify the AWS Specialization program type + designation name from workbook
 * title cells. AWS Competency / Service Delivery / Service Ready / MSP + the FTR
 * all share the same self-assessment template; only the title distinguishes them.
 * Pass the candidate title strings (e.g. each sheet's first row/col cells).
 */
export function detectProgram(
  titles: readonly string[],
): { programType: ProgramType; name: string } {
  const clean = (s: string): string =>
    s.replace(/\s+/g, " ").trim().replace(/^AWS\s+/i, "").trim();
  for (const raw of titles) {
    const t = (raw ?? "").replace(/\s+/g, " ").trim();
    if (t === "") continue;
    let m = /\b(.+?)\s+Competency\b/i.exec(t);
    if (m) return { programType: "Competency", name: clean(m[1]!) };
    m = /\b(.+?)\s+Service Delivery\b/i.exec(t);
    if (m) return { programType: "Service Delivery", name: clean(m[1]!) };
    m = /\b(.+?)\s+Service Ready\b/i.exec(t);
    if (m) return { programType: "Service Ready", name: clean(m[1]!) };
    if (/Managed Service Provider|\bMSP\b/i.test(t)) {
      return { programType: "MSP", name: "Managed Service Provider" };
    }
    if (/Foundational Technical Review/i.test(t)) {
      return { programType: "FTR", name: "Foundational Technical Review" };
    }
  }
  return { programType: "Unknown", name: "" };
}
