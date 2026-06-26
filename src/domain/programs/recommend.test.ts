import { describe, it, expect } from "vitest";
import {
  recommendCompetencies,
  leanForPartnerType,
  isRecommendedType,
  type RecommendInput,
} from "@/domain/programs/recommend";
import type { ProgramFit, PartnerLean } from "@/domain/evidence/fit";

function fit(over: Partial<ProgramFit>): ProgramFit {
  return {
    programKey: "migration_competency",
    name: "Migration Competency",
    programType: "Competency",
    deliveryModel: "Consulting",
    fundingFit: "high",
    requirements: [],
    metCount: 2,
    partialCount: 1,
    gapCount: 1,
    coveragePercent: 60,
    fitScore: 70,
    fitBand: "close",
    lean: "neutral",
    bonusPoints: 0,
    ...over,
  };
}

function input(over: Partial<RecommendInput>): RecommendInput {
  return {
    fits: [fit({})],
    profile: { partnerType: null, industry: null },
    readiness: {},
    adoptedKeys: new Set<string>(),
    ...over,
  };
}

describe("recommendCompetencies — scoring blend", () => {
  it("blends on coveragePercent, NOT fitScore (no business-model double-count)", () => {
    const recs = recommendCompetencies(input({ fits: [fit({ coveragePercent: 50, fitScore: 95 })] }));
    expect(recs[0]!.coveragePercent).toBe(50);
    expect(recs[0]!.components.coverageTerm).toBe(50); // tracks coverage, not fitScore 95
    expect(recs[0]!.evidenceFitScore).toBe(95); // still surfaced for parity
  });

  it("coverage dominates business model", () => {
    const recs = recommendCompetencies(
      input({
        // A: all coverage, zero business alignment (consulting program vs software lean).
        // B: zero coverage, perfect business alignment (software/specialization/high).
        fits: [
          fit({ programKey: "a", name: "A", programType: "Competency", deliveryModel: "Consulting", fundingFit: "low", coveragePercent: 100, lean: "software" }),
          fit({ programKey: "b", name: "B", programType: "Specialization", deliveryModel: "Software", fundingFit: "high", coveragePercent: 0, lean: "software" }),
        ],
        profile: { partnerType: "ISV / Software", industry: null },
      }),
    );
    const a = recs.find((r) => r.programKey === "a")!;
    const b = recs.find((r) => r.programKey === "b")!;
    expect(a.components.businessModelTerm).toBe(0);
    expect(b.components.businessModelTerm).toBe(100); // 60 + 30 + 10
    expect(a.recommendationScore).toBeGreaterThan(b.recommendationScore);
    expect(recs[0]!.programKey).toBe("a");
  });
});

describe("recommendCompetencies — lean reconciliation", () => {
  const lean = (partnerType: string | null, evidenceLean: PartnerLean, industry: string | null = null) =>
    recommendCompetencies(
      input({ fits: [fit({ lean: evidenceLean })], profile: { partnerType, industry } }),
    )[0]!;

  it("agree when declared and evidence match", () => {
    const r = lean("ISV / Software", "software");
    expect(r.leanReconciled).toBe("agree");
    expect(r.effectiveLean).toBe("software");
  });
  it("declared wins when they conflict", () => {
    const r = lean("ISV / Software", "consulting");
    expect(r.leanReconciled).toBe("declared_wins");
    expect(r.effectiveLean).toBe("software");
  });
  it("evidence_only when no declared model", () => {
    const r = lean(null, "consulting");
    expect(r.leanReconciled).toBe("evidence_only");
    expect(r.effectiveLean).toBe("consulting");
  });
  it("reseller is neutral (don't guess a competency lean)", () => {
    expect(leanForPartnerType("Reseller / Distributor")).toBe("neutral");
    const r = lean("Reseller / Distributor", "neutral");
    expect(r.leanReconciled).toBe("none");
    expect(r.effectiveLean).toBe("neutral");
  });
  it("Security industry nudges an otherwise-neutral declared lean", () => {
    const r = lean(null, "neutral", "Security");
    expect(r.effectiveLean).toBe("security");
  });
});

describe("recommendCompetencies — targetProgram", () => {
  it("fuzzy-matches the assessment target and boosts only that program's readiness", () => {
    const recs = recommendCompetencies(
      input({
        fits: [
          fit({ programKey: "mig", name: "Migration Competency", coveragePercent: 0 }),
          fit({ programKey: "sec", name: "Security Competency", coveragePercent: 0 }),
        ],
        readiness: { competency: 50, targetProgram: "Migration Competency" },
      }),
    );
    const mig = recs.find((r) => r.programKey === "mig")!;
    const sec = recs.find((r) => r.programKey === "sec")!;
    expect(mig.components.readinessTerm).toBe(65); // 50 + TARGET_BOOST(15)
    expect(sec.components.readinessTerm).toBe(50); // untouched
    expect(mig.rationale.some((c) => c.kind === "target")).toBe(true);
    expect(sec.rationale.some((c) => c.kind === "target")).toBe(false);
  });

  it("no boost when the target matches nothing", () => {
    const r = recommendCompetencies(
      input({ readiness: { competency: 50, targetProgram: "Nonexistent Program" } }),
    )[0]!;
    expect(r.components.readinessTerm).toBe(50);
    expect(r.rationale.some((c) => c.kind === "target")).toBe(false);
  });
});

describe("recommendCompetencies — missing-input degradation", () => {
  it("no scored assessment -> readiness absent, weights renormalize over 0-100 (not capped at 80)", () => {
    const r = recommendCompetencies(input({ fits: [fit({ coveragePercent: 100, lean: "neutral" })] }))[0]!;
    expect(r.components.readinessTerm).toBeNull();
    expect(r.components.weights.readiness).toBe(0);
    expect(r.components.weights.coverage + r.components.weights.businessModel).toBeCloseTo(1, 5);
    // (0.55*100 + 0.25*10 [high funding]) / 0.8 = 57.5/0.8 = 71.875 -> 72.
    // Full alignment would reach 100, proving there is no 80-cap from the missing term.
    expect(r.recommendationScore).toBe(72);
    expect(r.rationale.some((c) => c.label === "Readiness not yet assessed")).toBe(true);
  });

  it("no onboarding profile -> a 'Business model not set' chip, still ranked", () => {
    const r = recommendCompetencies(input({ profile: { partnerType: null, industry: null } }))[0]!;
    expect(r.rationale.some((c) => c.label === "Business model not set")).toBe(true);
    expect(r.recommendationScore).toBeGreaterThanOrEqual(0);
  });

  it("empty locker -> coverage 0, ranks from business + readiness, 'No evidence yet' chip", () => {
    const recs = recommendCompetencies(
      input({
        fits: [fit({ coveragePercent: 0 }), fit({ programKey: "z", name: "Z", coveragePercent: 0 })],
        profile: { partnerType: "Consulting / SI", industry: null },
        readiness: { competency: 80, gtm: 70 },
      }),
    );
    expect(recs[0]!.rationale.some((c) => c.label === "No evidence yet")).toBe(true);
    expect(recs[0]!.recommendationScore).toBeGreaterThan(0);
  });

  it("everything missing -> defined scores with deterministic programKey ordering", () => {
    const recs = recommendCompetencies(
      input({
        fits: [fit({ programKey: "b", coveragePercent: 0 }), fit({ programKey: "a", coveragePercent: 0 })],
      }),
    );
    expect(recs.every((r) => Number.isFinite(r.recommendationScore))).toBe(true);
    expect(recs.map((r) => r.programKey)).toEqual(["a", "b"]); // tie -> programKey asc
  });
});

describe("recommendCompetencies — adopted + types", () => {
  it("flags adopted programs but keeps them in the list", () => {
    const recs = recommendCompetencies(input({ adoptedKeys: new Set(["migration_competency"]) }));
    expect(recs[0]!.isAdopted).toBe(true);
    expect(recs).toHaveLength(1);
  });

  it("isRecommendedType covers competency / specialization / service delivery only", () => {
    expect(isRecommendedType("Competency")).toBe(true);
    expect(isRecommendedType("Specialization")).toBe(true);
    expect(isRecommendedType("Service Delivery")).toBe(true);
    expect(isRecommendedType("Tier")).toBe(false);
    expect(isRecommendedType("Program")).toBe(false);
  });
});
