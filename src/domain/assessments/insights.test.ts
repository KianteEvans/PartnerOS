import { describe, it, expect } from "vitest";
import {
  overallBand,
  moduleBand,
  weakestQuestions,
  moduleDeltas,
  deltaOf,
} from "@/domain/assessments/insights";
import type { ResponseMap, ScoredModule } from "@/domain/assessments/scoring";

describe("overallBand", () => {
  it("bands at 75 (strong) and 60 (fair)", () => {
    expect(overallBand(90)).toBe("strong");
    expect(overallBand(75)).toBe("strong");
    expect(overallBand(74)).toBe("fair");
    expect(overallBand(60)).toBe("fair");
    expect(overallBand(59)).toBe("at_risk");
    expect(overallBand(0)).toBe("at_risk");
  });
});

describe("moduleBand", () => {
  it("strength >=75, gap <60, on_track between", () => {
    expect(moduleBand(75)).toBe("strength");
    expect(moduleBand(74)).toBe("on_track");
    expect(moduleBand(60)).toBe("on_track");
    expect(moduleBand(59)).toBe("gap");
    expect(moduleBand(0)).toBe("gap");
  });
});

describe("weakestQuestions", () => {
  it("returns the lowest-scoring questions worst-first with the chosen answer label", () => {
    // GTM has: exec_sponsor (yes/partial/no), joint_plan + pipeline (maturity).
    const responses: ResponseMap = new Map([
      ["gtm.exec_sponsor", "yes"], // 100
      ["gtm.joint_plan", "partial"], // 40
      // gtm.pipeline left unanswered -> 0, "Not answered"
    ]);
    const weak = weakestQuestions("gtm", responses);
    expect(weak.map((w) => w.key)).toEqual(["gtm.pipeline", "gtm.joint_plan"]);
    expect(weak.map((w) => w.score)).toEqual([0, 40]);
    expect(weak[0]!.answerLabel).toBe("Not answered");
    expect(weak[1]!.answerLabel).toBe("In progress");
    expect(weak[0]!.prompt.length).toBeGreaterThan(0);
  });

  it("respects the limit", () => {
    expect(weakestQuestions("gtm", new Map(), 1)).toHaveLength(1);
  });
});

describe("moduleDeltas", () => {
  const current: ScoredModule[] = [
    { module: "gtm", score: 70 },
    { module: "competency", score: 60 },
  ];

  it("diffs each module against the prior assessment", () => {
    const prior: ScoredModule[] = [
      { module: "gtm", score: 50 },
      { module: "competency", score: 65 },
    ];
    const d = moduleDeltas(current, prior);
    expect(d).toEqual([
      { module: "gtm", current: 70, prior: 50, delta: 20 },
      { module: "competency", current: 60, prior: 65, delta: -5 },
    ]);
  });

  it("yields null deltas when there is no prior assessment", () => {
    const d = moduleDeltas(current, null);
    expect(d.every((m) => m.prior === null && m.delta === null)).toBe(true);
  });
});

describe("deltaOf", () => {
  it("subtracts when a prior exists, null otherwise", () => {
    expect(deltaOf(70, 50)).toBe(20);
    expect(deltaOf(70, null)).toBeNull();
  });
});
