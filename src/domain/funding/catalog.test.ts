import { describe, it, expect } from "vitest";
import {
  FUNDING_PROGRAMS,
  getFundingProgram,
  FUNDING_CATEGORY_LABELS,
  FUNDING_TYPE_LABELS,
  type FundingProgram,
} from "@/domain/funding/catalog";

describe("funding catalog", () => {
  it("has unique keys and non-empty core fields", () => {
    const keys = FUNDING_PROGRAMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of FUNDING_PROGRAMS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.eligibility.length).toBeGreaterThan(0);
      expect(p.phases.length).toBeGreaterThan(0);
      expect(p.applyUrl).toMatch(/^https?:\/\//);
    }
  });

  it("every eligibility criterion carries a human label", () => {
    for (const p of FUNDING_PROGRAMS) {
      for (const c of p.eligibility) {
        expect(c.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses only known categories + funding types", () => {
    for (const p of FUNDING_PROGRAMS) {
      expect(FUNDING_CATEGORY_LABELS[p.category]).toBeDefined();
      expect(FUNDING_TYPE_LABELS[p.fundingType]).toBeDefined();
    }
  });

  it("models MDF as an internally-managed program and the flagship migration program", () => {
    const mdf = getFundingProgram("mdf");
    expect(mdf?.managedInternally).toBe("mdf");
    expect(getFundingProgram("map")?.category).toBe("migration");
    expect(getFundingProgram("nope")).toBeUndefined();
  });

  it("covers the breadth of AWS funding categories", () => {
    const cats = new Set<FundingProgram["category"]>(FUNDING_PROGRAMS.map((p) => p.category));
    for (const c of ["migration", "poc", "marketing", "investment", "assessment", "workload", "incentive"] as const) {
      expect(cats.has(c)).toBe(true);
    }
  });
});
