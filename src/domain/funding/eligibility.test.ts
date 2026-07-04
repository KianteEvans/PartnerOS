import { describe, it, expect } from "vitest";
import { matchPrograms, eligibleDeals, evaluateProgram, type DealProfile, type PartnerContext, type DealRef } from "@/domain/funding/eligibility";
import { getFundingProgram } from "@/domain/funding/catalog";

function deal(over: Partial<DealProfile> = {}): DealProfile {
  return {
    amount: 150_000,
    stage: "business_validation",
    status: "open",
    source: "amazon_originated",
    workloadType: "migration",
    ...over,
  };
}

const selectCtx: PartnerContext = {
  tier: "select",
  competencyKeys: ["migration_competency"],
  solutionTypes: ["consulting_service"],
};

const map = getFundingProgram("map")!;
const sif = getFundingProgram("sif")!;
const mdf = getFundingProgram("mdf")!;

describe("funding eligibility", () => {
  it("a select-tier migration deal is eligible for MAP at full score", () => {
    const m = evaluateProgram(map, deal(), selectCtx);
    expect(m.eligible).toBe(true);
    expect(m.score).toBe(100);
    expect(m.unmet).toHaveLength(0);
  });

  it("gates on tier — SIF (Premier) is not eligible for a Select partner", () => {
    const m = evaluateProgram(sif, deal({ amount: 600_000 }), selectCtx);
    expect(m.eligible).toBe(false);
    expect(m.unmet.some((c) => c.kind === "min_tier")).toBe(true);
    expect(m.score).toBeLessThan(100);
  });

  it("a missing workload hint leaves the workload criterion unmet", () => {
    const m = evaluateProgram(map, deal({ workloadType: null }), selectCtx);
    expect(m.eligible).toBe(false);
    expect(m.unmet.some((c) => c.kind === "workload_type")).toBe(true);
  });

  it("gates on deal stage and size", () => {
    expect(evaluateProgram(map, deal({ stage: "qualified" }), selectCtx).eligible).toBe(false); // below business_validation
    expect(evaluateProgram(map, deal({ amount: 50_000 }), selectCtx).eligible).toBe(false); // below $100k
  });

  it("advisory `note` criteria never gate — MDF is eligible for a Select partner", () => {
    const m = evaluateProgram(mdf, deal(), selectCtx);
    expect(m.eligible).toBe(true);
    expect(m.met.some((c) => c.kind === "note")).toBe(true);
  });

  it("matchPrograms ranks eligible programs first", () => {
    const ranked = matchPrograms(deal(), selectCtx);
    expect(ranked[0]?.eligible).toBe(true);
    // once we hit an ineligible program, everything after is ineligible too
    const firstIneligible = ranked.findIndex((m) => !m.eligible);
    if (firstIneligible !== -1) {
      expect(ranked.slice(firstIneligible).every((m) => !m.eligible)).toBe(true);
    }
  });

  it("eligibleDeals filters a program to its qualifying deals", () => {
    const deals: DealRef[] = [
      { id: "a", name: "Big migration", profile: deal() },
      { id: "b", name: "Tiny early deal", profile: deal({ amount: 10_000, stage: "prospect" }) },
    ];
    const out = eligibleDeals(map, deals, selectCtx);
    expect(out.map((r) => r.deal.id)).toEqual(["a"]);
  });
});
