import { describe, it, expect } from "vitest";
import {
  gapFor,
  planSummary,
  isAchievable,
  canAdvance,
  phaseFor,
  advancementPlan,
  coverage,
  type RequirementValue,
} from "@/domain/tiers/gap";

function req(over: Partial<RequirementValue>): RequirementValue {
  return { key: "k", label: "L", category: "certifications", threshold: 10, currentValue: 0, ...over };
}

describe("tier gap analysis", () => {
  it("computes delta, met, and progress", () => {
    expect(gapFor(req({ threshold: 10, currentValue: 4 }))).toEqual({ delta: 6, met: false, progress: 40 });
    expect(gapFor(req({ threshold: 10, currentValue: 10 }))).toEqual({ delta: 0, met: true, progress: 100 });
    expect(gapFor(req({ threshold: 10, currentValue: 15 }))).toEqual({ delta: 0, met: true, progress: 100 });
  });

  it("summarizes met-of-total", () => {
    const reqs = [req({ currentValue: 10 }), req({ key: "b", currentValue: 5 }), req({ key: "c", currentValue: 0 })];
    expect(planSummary(reqs)).toEqual({ met: 1, total: 3, percent: 33 });
  });

  it("isAchievable only when every requirement is met", () => {
    expect(isAchievable([req({ currentValue: 10 }), req({ key: "b", currentValue: 10 })])).toBe(true);
    expect(isAchievable([req({ currentValue: 10 }), req({ key: "b", currentValue: 9 })])).toBe(false);
    expect(isAchievable([])).toBe(false);
  });

  it("canAdvance only moves strictly upward", () => {
    expect(canAdvance("registered", "select")).toBe(true);
    expect(canAdvance("select", "premier")).toBe(true);
    expect(canAdvance("advanced", "select")).toBe(false);
    expect(canAdvance("premier", "premier")).toBe(false);
  });

  it("buckets unmet requirements into 30/60/90 by remaining effort", () => {
    expect(phaseFor(req({ threshold: 10, currentValue: 8 }))).toBe(30); // 80%
    expect(phaseFor(req({ threshold: 10, currentValue: 5 }))).toBe(60); // 50%
    expect(phaseFor(req({ threshold: 10, currentValue: 1 }))).toBe(90); // 10%

    const reqs = [
      req({ key: "near", threshold: 10, currentValue: 9 }), // 30
      req({ key: "mid", threshold: 10, currentValue: 5 }), // 60
      req({ key: "far", threshold: 10, currentValue: 0 }), // 90
      req({ key: "done", threshold: 10, currentValue: 10 }), // excluded
    ];
    const plan = advancementPlan(reqs);
    expect(plan.phase30.map((r) => r.key)).toEqual(["near"]);
    expect(plan.phase60.map((r) => r.key)).toEqual(["mid"]);
    expect(plan.phase90.map((r) => r.key)).toEqual(["far"]);
  });

  it("coverage counts only OPEN gaps that are actioned (task or evidence)", () => {
    const c = coverage([
      { met: true, hasTask: false, hasEvidence: false }, // met -> not an open gap
      { met: false, hasTask: true, hasEvidence: false }, // open + task
      { met: false, hasTask: false, hasEvidence: true }, // open + evidence
      { met: false, hasTask: true, hasEvidence: true }, // open + both
      { met: false, hasTask: false, hasEvidence: false }, // open, unactioned
    ]);
    expect(c).toEqual({ total: 5, met: 1, open: 4, withTask: 2, withEvidence: 2, actioned: 3 });
  });

  it("coverage on an all-met plan reports zero open gaps", () => {
    expect(coverage([{ met: true, hasTask: false, hasEvidence: false }])).toEqual({
      total: 1, met: 1, open: 0, withTask: 0, withEvidence: 0, actioned: 0,
    });
    expect(coverage([])).toEqual({ total: 0, met: 0, open: 0, withTask: 0, withEvidence: 0, actioned: 0 });
  });

  it("a boolean requirement is met at 1, with 0/100 progress", () => {
    expect(gapFor(req({ kind: "boolean", threshold: 1, currentValue: 0 }))).toEqual({ delta: 1, met: false, progress: 0 });
    expect(gapFor(req({ kind: "boolean", threshold: 1, currentValue: 1 }))).toEqual({ delta: 0, met: true, progress: 100 });
  });

  it("a secondary constraint must also be met and binds the progress", () => {
    // primary met, secondary not -> unmet; progress reflects the tighter (secondary).
    expect(gapFor(req({ threshold: 20, currentValue: 20, secondaryThreshold: 10000, secondaryCurrentValue: 5000 }))).toEqual({
      delta: 0, met: false, progress: 50,
    });
    // both met
    expect(gapFor(req({ threshold: 20, currentValue: 20, secondaryThreshold: 10000, secondaryCurrentValue: 10000 }))).toEqual({
      delta: 0, met: true, progress: 100,
    });
    // primary not met -> primary delta + tighter progress
    expect(gapFor(req({ threshold: 20, currentValue: 10, secondaryThreshold: 10000, secondaryCurrentValue: 10000 }))).toEqual({
      delta: 10, met: false, progress: 50,
    });
  });

  it("informational requirements are excluded from the gate, summary, and plan", () => {
    const fee = req({ key: "fee", informational: true, threshold: 2500, currentValue: 0 });
    const counted = req({ key: "c", threshold: 10, currentValue: 10 });
    expect(planSummary([fee, counted])).toEqual({ met: 1, total: 1, percent: 100 });
    expect(isAchievable([fee, counted])).toBe(true);
    const plan = advancementPlan([fee, counted]);
    expect([...plan.phase30, ...plan.phase60, ...plan.phase90]).toEqual([]);
  });
});
