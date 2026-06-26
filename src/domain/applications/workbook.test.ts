import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadWorkbook, fillWorkbook, parseWorkbook } from "@/domain/applications/workbook";
import { fromA1 } from "@/domain/applications/cells";

/**
 * Codec round-trip against a REAL AWS Competency workbook (a public template,
 * committed under tests/fixtures). Verifies: detection finds practice controls,
 * a filled response survives a load -> fill -> save -> reload cycle, the sheet
 * set is unchanged, and any Met? data-validation dropdown is preserved.
 */

const FIXTURE = fileURLToPath(
  new URL("../../../tests/fixtures/security-competency.xlsx", import.meta.url),
);
const bytes = new Uint8Array(readFileSync(FIXTURE));
const FTR_FIXTURE = fileURLToPath(
  new URL("../../../tests/fixtures/ftr-service-offering.xlsx", import.meta.url),
);
const ftrBytes = new Uint8Array(readFileSync(FTR_FIXTURE));

function countValidations(wb: { worksheets: unknown[] }): number {
  let n = 0;
  for (const ws of wb.worksheets) {
    const dv = (ws as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations;
    if (dv?.model) n += Object.keys(dv.model).length;
  }
  return n;
}

describe("workbook codec (real AWS fixture)", () => {
  it("detects the program type, name, and practice controls", async () => {
    const parsed = await parseWorkbook(bytes);
    expect(parsed.programType).toBe("Competency");
    expect(parsed.name).toContain("Security");
    const practice = parsed.controls.filter(
      (c) => c.responseTargets.length === 1 && c.responseTargets[0]!.refLabel === undefined,
    );
    expect(practice.length).toBeGreaterThan(0);
    // A known practice control id from this template.
    expect(parsed.controls.some((c) => c.id === "GEN-001")).toBe(true);
    // Both sheet kinds present.
    const kinds = new Set(parsed.sheets.map((s) => s.kind));
    expect(kinds.has("practice")).toBe(true);
    expect(kinds.has("customer_example")).toBe(true);
  });

  it("round-trips a filled response and preserves sheets + dropdowns", async () => {
    const loaded = await loadWorkbook(bytes);
    const parsed = await parseWorkbook(bytes);
    const ctrl = parsed.controls.find(
      (c) => c.responseTargets.length === 1 && c.responseTargets[0]!.refLabel === undefined,
    )!;
    const target = ctrl.responseTargets[0]!;

    const beforeValidations = countValidations(loaded.wb as unknown as { worksheets: unknown[] });
    const beforeSheets = loaded.sheets.map((s) => s.name);

    const out = await fillWorkbook(loaded.wb, [
      { sheet: ctrl.sheetName, cellAddress: target.responseAddress, value: "ROUND TRIP MARKER 123" },
      { sheet: ctrl.sheetName, cellAddress: target.metAddress, value: "Yes" },
    ]);

    const reloaded = await loadWorkbook(out);
    expect(reloaded.sheets.map((s) => s.name)).toEqual(beforeSheets); // unchanged
    const sheet = reloaded.sheets.find((s) => s.name === ctrl.sheetName)!;
    const { row, col } = fromA1(target.responseAddress);
    expect(sheet.grid[row]![col]).toContain("ROUND TRIP MARKER 123");

    // Dropdown preservation: if the original had any list validations, they survive.
    const afterValidations = countValidations(reloaded.wb as unknown as { worksheets: unknown[] });
    if (beforeValidations > 0) expect(afterValidations).toBeGreaterThanOrEqual(beforeValidations);
  });

  it("parses a non-Competency program (FTR) with the same engine", async () => {
    const parsed = await parseWorkbook(ftrBytes);
    expect(parsed.programType).toBe("FTR");
    expect(parsed.controls.length).toBeGreaterThan(0);
  });
});
