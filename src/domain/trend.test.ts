import { describe, it, expect } from "vitest";
import { sparklinePoints, trendDelta } from "@/domain/trend";

describe("sparklinePoints", () => {
  it("returns empty for no values", () => {
    expect(sparklinePoints([], 58, 20)).toBe("");
  });

  it("centers a single point", () => {
    const p = sparklinePoints([5], 58, 20);
    expect(p).toBe("29,10");
  });

  it("flat series -> all points at mid-height", () => {
    const p = sparklinePoints([3, 3, 3], 60, 20).split(" ");
    expect(p).toHaveLength(3);
    expect(p.every((pt) => pt.endsWith(",10"))).toBe(true);
  });

  it("ascending series rises (y decreases left to right)", () => {
    const pts = sparklinePoints([1, 2, 3], 60, 20)
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    expect(pts[0]).toBeGreaterThan(pts[1]!);
    expect(pts[1]).toBeGreaterThan(pts[2]!);
  });

  it("emits one coordinate pair per value", () => {
    expect(sparklinePoints([1, 4, 2, 8, 5], 58, 20).split(" ")).toHaveLength(5);
  });
});

describe("trendDelta", () => {
  it("null when fewer than 2 points", () => {
    expect(trendDelta([])).toBeNull();
    expect(trendDelta([5])).toBeNull();
  });
  it("last minus previous", () => {
    expect(trendDelta([3, 5])).toBe(2);
    expect(trendDelta([8, 6, 3])).toBe(-3);
    expect(trendDelta([4, 4])).toBe(0);
  });
});
