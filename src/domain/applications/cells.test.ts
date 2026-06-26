import { describe, it, expect } from "vitest";
import { colToLetters, lettersToCol, toA1, fromA1 } from "@/domain/applications/cells";

describe("cells", () => {
  it("colToLetters at boundaries", () => {
    expect(colToLetters(0)).toBe("A");
    expect(colToLetters(25)).toBe("Z");
    expect(colToLetters(26)).toBe("AA");
    expect(colToLetters(51)).toBe("AZ");
    expect(colToLetters(701)).toBe("ZZ");
    expect(colToLetters(702)).toBe("AAA");
  });
  it("lettersToCol round-trips colToLetters", () => {
    for (const n of [0, 25, 26, 51, 701, 702]) {
      expect(lettersToCol(colToLetters(n))).toBe(n);
    }
  });
  it("toA1 / fromA1 round-trip", () => {
    expect(toA1(4, 3)).toBe("D5");
    expect(fromA1("D5")).toEqual({ row: 4, col: 3 });
    expect(fromA1("AA1")).toEqual({ row: 0, col: 26 });
    expect(toA1(0, 26)).toBe("AA1");
  });
});
