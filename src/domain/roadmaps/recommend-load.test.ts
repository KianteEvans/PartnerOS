import { describe, it, expect } from "vitest";
import { filterRecommendations, type RecommendationInput } from "@/domain/roadmaps/recommend-filter";
import { PROGRAM_LIBRARY, getLibraryProgram } from "@/domain/programs/library";

const realKey = PROGRAM_LIBRARY[0]!.key;

const rec = (programKey: string, over: Partial<RecommendationInput> = {}): RecommendationInput => ({
  programKey,
  name: programKey.toUpperCase(),
  programType: "Competency",
  deliveryModel: "Consulting",
  fundingFit: "high",
  recommendationScore: 50,
  band: "close",
  isAdopted: false,
  rationale: [
    { kind: "funding", label: "High funding fit", detail: "x", tone: "info" },
    { kind: "evidence", label: "Strong evidence", detail: "y", tone: "ok" },
    { kind: "target", label: "Target program", detail: "z", tone: "neutral" },
  ],
  ...over,
});

describe("filterRecommendations", () => {
  it("drops adopted and excluded programs, preserving rank order", () => {
    const out = filterRecommendations(
      [rec("a"), rec("b", { isAdopted: true }), rec("c"), rec("d")],
      new Set(["d"]),
    );
    expect(out.map((r) => r.key)).toEqual(["a", "c"]);
  });

  it("maps the lean shape and the program's requirement count", () => {
    const out = filterRecommendations([rec(realKey, { recommendationScore: 88, band: "ready" })], new Set());
    expect(out[0]!.key).toBe(realKey);
    expect(out[0]!.score).toBe(88);
    expect(out[0]!.band).toBe("ready");
    expect(out[0]!.requirementCount).toBe(getLibraryProgram(realKey)!.requirements.length);
    expect(out[0]!.topRationale).toHaveLength(2); // top 2 only
  });

  it("falls back to 0 requirements for an unknown program key", () => {
    const out = filterRecommendations([rec("nonexistent-program")], new Set());
    expect(out[0]!.requirementCount).toBe(0);
  });
});
