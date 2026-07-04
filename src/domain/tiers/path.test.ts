import { describe, it, expect } from "vitest";
import {
  tierPath,
  tierVelocity,
  ownerLoad,
  cheapestCompetencyStack,
  type CompetencyOption,
} from "@/domain/tiers/path";
import type { RequirementValue } from "@/domain/tiers/gap";

const TODAY = "2026-06-23";

const req = (over: Partial<RequirementValue> & { key: string }): RequirementValue => ({
  label: over.key,
  category: "c",
  threshold: 3,
  currentValue: 0,
  ...over,
});

describe("tierPath", () => {
  it("is achievable with no scenarios when every gating requirement is met", () => {
    const p = tierPath([req({ key: "a", threshold: 2, currentValue: 2 })], TODAY, "Advanced");
    expect(p.achievable).toBe(true);
    expect(p.scenarios).toEqual([]);
  });

  it("orders unmet requirements closest-first and produces 3 scenarios with monotonic ETAs", () => {
    const p = tierPath(
      [
        req({ key: "far", threshold: 3, currentValue: 1 }), // 33%
        req({ key: "near", threshold: 3, currentValue: 2 }), // 67% -> first
        req({ key: "fee", threshold: 2500, currentValue: 0, informational: true }), // skipped
      ],
      TODAY,
      "Advanced",
    );
    expect(p.achievable).toBe(false);
    expect(p.remaining).toBe(2);
    expect(p.scenarios).toHaveLength(3);
    // closest-first: "near" (67%) before "far" (33%)
    expect(p.scenarios[0]!.steps.map((s) => s.key)).toEqual(["near", "far"]);
    // ETAs: aggressive < steady < deliberate
    const [agg, steady, deliberate] = p.scenarios;
    expect(agg!.etaDate! < steady!.etaDate!).toBe(true);
    expect(steady!.etaDate! < deliberate!.etaDate!).toBe(true);
    // steps are dated + carry progress
    expect(agg!.steps[0]!.targetDate > TODAY).toBe(true);
    expect(agg!.steps[0]!.progress).toBe(67);
  });
});

describe("tierVelocity", () => {
  it("projects a completion date from a positive trend", () => {
    const v = tierVelocity(
      [
        { capturedOn: "2026-06-13", percent: 40 },
        { capturedOn: "2026-06-23", percent: 60 },
      ],
      60,
      TODAY,
    );
    expect(v.velocityPerDay).toBe(2); // (60-40)/10 days
    expect(v.projectedDate).toBe("2026-07-13"); // +20 days for the remaining 40%
    expect(v.band).toBe("on_track");
  });

  it("flags 'slow' when the projection lands after the target date", () => {
    const v = tierVelocity(
      [
        { capturedOn: "2026-06-13", percent: 40 },
        { capturedOn: "2026-06-23", percent: 60 },
      ],
      60,
      TODAY,
      "2026-07-01",
    );
    expect(v.band).toBe("slow");
  });

  it("returns 'none' for flat or insufficient history", () => {
    expect(tierVelocity([], 50, TODAY).band).toBe("none");
    expect(
      tierVelocity([{ capturedOn: "2026-06-13", percent: 50 }, { capturedOn: "2026-06-23", percent: 50 }], 50, TODAY).band,
    ).toBe("none");
  });
});

describe("ownerLoad", () => {
  it("groups by owner (busiest first) and flags a bottleneck when work is unowned", () => {
    const c = ownerLoad([
      { ownerUserId: "u1", label: "A" },
      { ownerUserId: "u1", label: "B" },
      { ownerUserId: null, label: "C" },
    ]);
    expect(c.loads[0]!.ownerUserId).toBe("u1");
    expect(c.loads[0]!.count).toBe(2);
    expect(c.unowned).toBe(1);
    expect(c.bottleneck).toBe(true);
  });

  it("flags a bottleneck when one owner holds half or more", () => {
    const c = ownerLoad([
      { ownerUserId: "u1", label: "A" },
      { ownerUserId: "u1", label: "B" },
      { ownerUserId: "u2", label: "C" },
      { ownerUserId: "u3", label: "D" },
    ]);
    expect(c.unowned).toBe(0);
    expect(c.bottleneck).toBe(true); // u1 holds 2 of 4
  });
});

describe("cheapestCompetencyStack", () => {
  const opt = (over: Partial<CompetencyOption> & { programKey: string }): CompetencyOption => ({
    name: over.programKey,
    programType: "Competency",
    gapCount: 2,
    coveragePercent: 50,
    ...over,
  });

  it("picks the fewest-gap, not-yet-adopted competencies up to `need`", () => {
    const picks = cheapestCompetencyStack(
      [
        opt({ programKey: "hard", gapCount: 4 }),
        opt({ programKey: "easy", gapCount: 1 }),
        opt({ programKey: "adopted", gapCount: 0 }),
        opt({ programKey: "mid", gapCount: 2 }),
        opt({ programKey: "not_a_comp", gapCount: 0, programType: "Service Delivery" }),
      ],
      2,
      new Set(["adopted"]),
    );
    expect(picks.map((p) => p.programKey)).toEqual(["easy", "mid"]);
  });

  it("returns nothing when nothing is needed", () => {
    expect(cheapestCompetencyStack([opt({ programKey: "x" })], 0, new Set())).toEqual([]);
  });
});
