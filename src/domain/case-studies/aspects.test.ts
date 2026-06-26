import { describe, it, expect } from "vitest";
import { CASE_STUDY_ASPECTS, caseStudyCompleteness } from "@/domain/case-studies/aspects";

const empty = { aboutCustomer: "", challenge: "", goals: "", solution: "", outcomes: "" };

describe("CASE_STUDY_ASPECTS", () => {
  it("defines the five customer-example narrative aspects in order", () => {
    expect(CASE_STUDY_ASPECTS.map((a) => a.key)).toEqual([
      "aboutCustomer",
      "challenge",
      "goals",
      "solution",
      "outcomes",
    ]);
  });
});

describe("caseStudyCompleteness", () => {
  it("counts filled aspects", () => {
    expect(caseStudyCompleteness(empty)).toEqual({ filled: 0, total: 5, percent: 0 });
    expect(caseStudyCompleteness({ ...empty, aboutCustomer: "x", challenge: "y" })).toEqual({
      filled: 2,
      total: 5,
      percent: 40,
    });
    expect(
      caseStudyCompleteness({ aboutCustomer: "a", challenge: "b", goals: "c", solution: "d", outcomes: "e" }),
    ).toEqual({ filled: 5, total: 5, percent: 100 });
  });
  it("treats whitespace-only as empty", () => {
    expect(caseStudyCompleteness({ ...empty, aboutCustomer: "   " }).filled).toBe(0);
  });
});
