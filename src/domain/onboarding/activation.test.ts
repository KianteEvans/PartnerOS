import { describe, it, expect } from "vitest";
import { activationChecklist, type ActivationCounts } from "@/domain/onboarding/activation";

const EMPTY: ActivationCounts = {
  assessmentScored: false,
  roadmaps: 0,
  adoptedPrograms: 0,
  evidence: 0,
  opportunities: 0,
  mdfRequests: 0,
  solutions: 0,
  tierPlan: false,
};

describe("activationChecklist", () => {
  it("has the four baseline items, all undone on an empty workspace", () => {
    const a = activationChecklist({ objectives: [] }, EMPTY);
    expect(a.items.map((i) => i.key)).toEqual(["assessment", "roadmap", "competency", "evidence"]);
    expect(a.doneCount).toBe(0);
    expect(a.percent).toBe(0);
    expect(a.complete).toBe(false);
    expect(a.items.every((i) => !i.objectiveDriven)).toBe(true);
  });

  it("marks items done from live counts and computes percent", () => {
    const a = activationChecklist({ objectives: [] }, { ...EMPTY, assessmentScored: true, roadmaps: 1 });
    expect(a.doneCount).toBe(2);
    expect(a.total).toBe(4);
    expect(a.percent).toBe(50);
    expect(a.items.find((i) => i.key === "roadmap")!.done).toBe(true);
  });

  it("appends objective-driven items (skipping ones already baseline) and tracks them", () => {
    const a = activationChecklist(
      { objectives: ["cosell", "mdf", "competency", "evidence"] },
      { ...EMPTY, opportunities: 2 },
    );
    // baseline(4) + cosell + mdf; competency & evidence are baseline-covered
    expect(a.items.map((i) => i.key)).toEqual([
      "assessment",
      "roadmap",
      "competency",
      "evidence",
      "obj:cosell",
      "obj:mdf",
    ]);
    expect(a.items.find((i) => i.key === "obj:cosell")!.done).toBe(true); // 2 opps
    expect(a.items.find((i) => i.key === "obj:mdf")!.done).toBe(false);
    expect(a.items.find((i) => i.key === "obj:cosell")!.objectiveDriven).toBe(true);
  });

  it("is complete only when every item is done", () => {
    const full: ActivationCounts = {
      assessmentScored: true,
      roadmaps: 1,
      adoptedPrograms: 1,
      evidence: 1,
      opportunities: 1,
      mdfRequests: 1,
      solutions: 1,
      tierPlan: true,
    };
    const a = activationChecklist({ objectives: ["cosell", "mdf", "marketplace", "tier_advancement"] }, full);
    expect(a.complete).toBe(true);
    expect(a.percent).toBe(100);
    expect(a.total).toBe(8); // 4 baseline + 4 objective-driven
  });
});
