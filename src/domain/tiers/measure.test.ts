import { describe, it, expect } from "vitest";
import { measuredValueFor, deriveByKey, type TierMeasurements } from "@/domain/tiers/measure";

const M = (over: Partial<TierMeasurements> = {}): TierMeasurements => ({
  launchedCount: 0,
  competencyCount: 0,
  sustainedMonths: 0,
  ...over,
});

describe("tier auto-measurement", () => {
  it("maps each derive source to its measured value", () => {
    const m = M({ launchedCount: 12, competencyCount: 4, sustainedMonths: 9 });
    expect(measuredValueFor("launched_count", m)).toBe(12);
    expect(measuredValueFor("competency_count", m)).toBe(4);
    expect(measuredValueFor("sustained", m)).toBe(1); // 9 >= 6
    expect(measuredValueFor(undefined, m)).toBeNull();
  });

  it("sustained attainment is met only at 6+ months", () => {
    expect(measuredValueFor("sustained", M({ sustainedMonths: 5 }))).toBe(0);
    expect(measuredValueFor("sustained", M({ sustainedMonths: 6 }))).toBe(1);
  });

  it("derives only the requirements a tier actually marks derivable", () => {
    const m = M({ launchedCount: 8, competencyCount: 3, sustainedMonths: 7 });
    // Advanced derives only the launched-opportunity count.
    const adv = deriveByKey("advanced", m);
    expect([...adv.keys()]).toEqual(["launched_opportunities"]);
    expect(adv.get("launched_opportunities")).toBe(8);
    // Premier derives launched count, competency count, and sustained attainment.
    const prem = deriveByKey("premier", m);
    expect(new Set(prem.keys())).toEqual(new Set(["launched_opportunities", "competencies", "sustained_attainment"]));
    expect(prem.get("competencies")).toBe(3);
    expect(prem.get("sustained_attainment")).toBe(1);
  });
});
