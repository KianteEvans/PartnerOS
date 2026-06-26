import ExcelJS from "exceljs";
import { detectSheet, detectProgram, type ProgramType } from "@/domain/applications/detect";
import type { Control, DetectedSheet } from "@/domain/applications/grid";

/**
 * The ONLY module that imports the xlsx codec (ExcelJS). Server-only by
 * convention (imported solely by operations/actions/the export route) so ExcelJS
 * never reaches the client bundle — same convention as the AWS clients. Reads a
 * workbook into per-sheet grids (for the pure detection engine) + the live
 * workbook (for in-place filling), and writes filled cells back while preserving
 * everything else (the Met? dropdowns, styles, other sheets).
 */

export interface LoadedSheet {
  readonly name: string;
  readonly grid: string[][];
}
export interface LoadedWorkbook {
  readonly sheets: readonly LoadedSheet[];
  readonly wb: ExcelJS.Workbook;
}

export interface ParsedWorkbook {
  /** AWS Specialization program type (Competency / Service Delivery / etc.). */
  readonly programType: ProgramType;
  /** Designation name from the workbook title (e.g. "Security", "Amazon EKS"). */
  readonly name: string;
  readonly sheets: readonly DetectedSheet[];
  /** Flattened controls across all practice + customer-example sheets. */
  readonly controls: readonly Control[];
}

export interface CellFill {
  readonly sheet: string;
  readonly cellAddress: string;
  readonly value: string;
}

function cellText(c: ExcelJS.Cell): string {
  try {
    const t = c.text;
    return t === null || t === undefined ? "" : String(t).trim();
  } catch {
    const v = c.value;
    return v === null || v === undefined ? "" : String(v).trim();
  }
}

/** Parse uploaded bytes into per-sheet grids + the live workbook for filling. */
export async function loadWorkbook(bytes: Uint8Array): Promise<LoadedWorkbook> {
  const wb = new ExcelJS.Workbook();
  // Cast around the Node Buffer<ArrayBuffer> vs ExcelJS Buffer typing mismatch.
  await wb.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const sheets: LoadedSheet[] = [];
  wb.eachSheet((ws) => {
    const maxRow = ws.rowCount;
    const maxCol = ws.columnCount;
    const rows: string[][] = [];
    for (let r = 1; r <= maxRow; r += 1) {
      const row = ws.getRow(r);
      const out: string[] = [];
      for (let c = 1; c <= maxCol; c += 1) out.push(cellText(row.getCell(c)));
      rows.push(out);
    }
    sheets.push({ name: ws.name, grid: rows });
  });
  return { sheets, wb };
}

/** Run the pure detection engine over a loaded workbook's grids. */
export function detectWorkbook(loaded: LoadedWorkbook): ParsedWorkbook {
  const sheets = loaded.sheets.map((s) => detectSheet(s.grid, s.name));
  const titles: string[] = [];
  for (const s of loaded.sheets) {
    if (s.grid[0]?.[0]) titles.push(s.grid[0][0]!);
    if (s.grid[1]?.[0]) titles.push(s.grid[1][0]!);
  }
  const { programType, name } = detectProgram(titles);
  return { programType, name, sheets, controls: sheets.flatMap((s) => s.controls) };
}

/** Convenience: load + detect in one step (used by the upload action). */
export async function parseWorkbook(bytes: Uint8Array): Promise<ParsedWorkbook> {
  return detectWorkbook(await loadWorkbook(bytes));
}

/**
 * Write each fill IN PLACE (only cell.value), then serialize to xlsx bytes. Never
 * touches style/dataValidation/model, so the Met? dropdowns + formatting survive.
 */
export async function fillWorkbook(
  wb: ExcelJS.Workbook,
  fills: readonly CellFill[],
): Promise<Uint8Array> {
  for (const f of fills) {
    if (!f.value) continue;
    const ws = wb.getWorksheet(f.sheet);
    if (!ws) continue;
    ws.getCell(f.cellAddress).value = f.value;
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
