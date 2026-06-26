import { describe, it, expect } from "vitest";
import { programRoi, roiRollup, type RoiOppLike } from "@/domain/programs/roi";

const ACHIEVED = "2026-03-01";

function o(over: Partial<RoiOppLike>): RoiOppLike {
  return {
    status: "open",
    stage: "qualified",
    amount: 50_000,
    closeDate: null,
    ...over,
  };
}

describe("programRoi", () => {
  it("buckets open / won / launched independently (never summed)", () => {
    const roi = programRoi(
      [
        o({ status: "open", stage: "qualified", amount: 30_000 }),
        o({ status: "won", stage: "launched", amount: 120_000, closeDate: "2026-04-01" }), // BOTH won and launched
        o({ status: "lost", stage: "closed_lost", amount: 9_000 }),
      ],
      ACHIEVED,
    );
    expect(roi.attributedCount).toBe(3); // incl. lost
    expect(roi.openCount).toBe(1);
    expect(roi.openTCV).toBe(30_000);
    expect(roi.wonCount).toBe(1);
    expect(roi.wonTCV).toBe(120_000);
    // The won+launched deal appears in BOTH buckets, counted once in each.
    expect(roi.launchedCount).toBe(1);
    expect(roi.launchedTCV).toBe(120_000);
  });

  it("conservative influence: only attributed wins on/after achievement, close date required", () => {
    const roi = programRoi(
      [
        o({ status: "won", amount: 100_000, closeDate: "2026-04-01" }), // after -> influenced
        o({ status: "won", amount: 70_000, closeDate: "2026-03-01" }), // exactly on boundary -> influenced
        o({ status: "won", amount: 40_000, closeDate: "2026-01-15" }), // before -> not influenced
        o({ status: "won", amount: 25_000, closeDate: null }), // no close date -> excluded
      ],
      ACHIEVED,
    );
    expect(roi.wonCount).toBe(4); // all four are wins
    expect(roi.wonTCV).toBe(235_000);
    expect(roi.influencedWonCount).toBe(2); // the after + the boundary
    expect(roi.influencedWonTCV).toBe(170_000);
  });

  it("returns null influence when the program has no achievement date", () => {
    const roi = programRoi(
      [o({ status: "won", amount: 100_000, closeDate: "2026-04-01" })],
      null,
    );
    expect(roi.wonTCV).toBe(100_000);
    expect(roi.influencedWonCount).toBeNull();
    expect(roi.influencedWonTCV).toBeNull();
  });

  it("empty -> zeros, with influence null iff achievedAt is null", () => {
    expect(programRoi([], ACHIEVED)).toMatchObject({
      attributedCount: 0,
      wonTCV: 0,
      influencedWonTCV: 0,
    });
    expect(programRoi([], null).influencedWonTCV).toBeNull();
  });
});

describe("roiRollup", () => {
  it("sums each bucket independently and sorts byProgram by won TCV desc", () => {
    const a = programRoi([o({ status: "won", amount: 50_000, closeDate: "2026-04-01" })], ACHIEVED);
    const b = programRoi([o({ status: "won", amount: 200_000, closeDate: "2026-04-01" })], ACHIEVED);
    const c = programRoi([o({ status: "open", amount: 10_000 })], null); // no achievement -> null influence

    const rollup = roiRollup([
      { name: "Migration", roi: a },
      { name: "Security", roi: b },
      { name: "DevOps", roi: c },
    ]);
    expect(rollup.programs).toBe(3);
    expect(rollup.wonTCV).toBe(250_000);
    expect(rollup.openTCV).toBe(10_000);
    // null influence contributes 0 to the sum, not NaN.
    expect(rollup.influencedWonTCV).toBe(250_000);
    expect(rollup.byProgram.map((p) => p.name)).toEqual(["Security", "Migration", "DevOps"]);
  });
});
