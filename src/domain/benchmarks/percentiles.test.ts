import { describe, it, expect } from "vitest";
import {
  MIN_COHORT,
  BENCHMARK_METRICS,
  metricByKey,
  percentile,
  summarize,
  positionOf,
  tenureBucket,
  formatMetric,
  ordinal,
  TENURE_BUCKETS,
  DIMENSIONS,
} from "./percentiles";

describe("benchmark catalog", () => {
  it("k-anonymity threshold is 5", () => {
    expect(MIN_COHORT).toBe(5);
  });

  it("covers 7 metrics with unique keys", () => {
    expect(BENCHMARK_METRICS).toHaveLength(7);
    const keys = new Set(BENCHMARK_METRICS.map((m) => m.key));
    expect(keys.size).toBe(7);
  });

  it("resolves a metric by key", () => {
    expect(metricByKey("health").format).toBe("score");
    expect(metricByKey("mdf_roi").format).toBe("multiple");
    expect(metricByKey("win_rate").nullable).toBe(true);
    expect(metricByKey("evidence").nullable).toBe(false);
  });

  it("has two cohort dimensions and four tenure buckets", () => {
    expect(DIMENSIONS).toEqual(["tier", "tenure"]);
    expect(TENURE_BUCKETS).toHaveLength(4);
  });
});

describe("percentile", () => {
  it("interpolates linearly between ranks", () => {
    const xs = [10, 20, 30, 40];
    expect(percentile(xs, 50)).toBe(25); // rank 1.5 -> midway 20..30
    expect(percentile(xs, 25)).toBeCloseTo(17.5); // rank 0.75
    expect(percentile(xs, 75)).toBeCloseTo(32.5); // rank 2.25
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 100)).toBe(40);
  });

  it("handles empty and singleton arrays", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([42], 90)).toBe(42);
  });
});

describe("summarize", () => {
  it("drops nulls/undefined/non-finite and counts the rest", () => {
    const s = summarize([10, null, 20, undefined, 30, 40, Number.NaN]);
    expect(s.count).toBe(4);
    expect(s.p50).toBe(25);
  });

  it("returns integer percentiles (cohort store is bigint)", () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Number.isInteger(s.p25)).toBe(true);
    expect(Number.isInteger(s.p90)).toBe(true);
    expect(s.p25).toBeLessThanOrEqual(s.p50);
    expect(s.p50).toBeLessThanOrEqual(s.p75);
    expect(s.p75).toBeLessThanOrEqual(s.p90);
  });

  it("empty set has count 0 (would be blocked by k-anonymity)", () => {
    const s = summarize([null, undefined]);
    expect(s.count).toBe(0);
    expect(s.count).toBeLessThan(MIN_COHORT);
  });
});

describe("positionOf", () => {
  const cohort = summarize([10, 20, 30, 40, 50, 60, 70, 80]);
  // -> p25=28, p50=45, p75=63, p90=73 (rounded)

  it("bands split at p25/p50/p75", () => {
    expect(positionOf(cohort.p75 + 1, cohort).band).toBe("top_quartile");
    expect(positionOf(cohort.p50 + 1, cohort).band).toBe("above_median");
    expect(positionOf(cohort.p25 + 1, cohort).band).toBe("below_median");
    expect(positionOf(cohort.p25 - 1, cohort).band).toBe("bottom_quartile");
  });

  it("value at an anchor lands near that percentile", () => {
    expect(positionOf(cohort.p50, cohort).percentile).toBe(50);
    expect(positionOf(cohort.p75, cohort).percentile).toBe(75);
    expect(positionOf(cohort.p25, cohort).percentile).toBe(25);
  });

  it("caps above the p90 anchor", () => {
    expect(positionOf(cohort.p90 + 1000, cohort).percentile).toBe(95);
    expect(positionOf(cohort.p90 + 1000, cohort).band).toBe("top_quartile");
  });

  it("clamps at/below zero", () => {
    expect(positionOf(0, cohort).percentile).toBe(0);
    expect(positionOf(0, cohort).band).toBe("bottom_quartile");
  });
});

describe("tenureBucket", () => {
  it("buckets by whole calendar months", () => {
    expect(tenureBucket("2026-06-15", "2026-07-01")).toBe("0_6mo"); // <6mo
    expect(tenureBucket("2026-01-01", "2026-07-01")).toBe("6_12mo"); // exactly 6mo
    expect(tenureBucket("2025-07-01", "2026-07-01")).toBe("12_24mo"); // exactly 12mo
    expect(tenureBucket("2024-07-01", "2026-07-01")).toBe("24mo_plus"); // exactly 24mo
    expect(tenureBucket("2020-01-01", "2026-07-01")).toBe("24mo_plus");
  });

  it("respects the day-of-month for boundary anniversaries", () => {
    // created on the 15th; by the 1st of the +6 month, the anniversary hasn't hit
    expect(tenureBucket("2026-01-15", "2026-07-01")).toBe("0_6mo");
    expect(tenureBucket("2026-01-15", "2026-07-15")).toBe("6_12mo");
  });
});

describe("formatMetric", () => {
  it("formats each metric shape", () => {
    expect(formatMetric("score", 72.4)).toBe("72");
    expect(formatMetric("count", 3)).toBe("3");
    expect(formatMetric("percent", 68.6)).toBe("69%");
    expect(formatMetric("money", 123456)).toContain("$");
    expect(formatMetric("multiple", 240)).toBe("2.4x");
  });
});

describe("ordinal", () => {
  it("adds the right suffix", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(72)).toBe("72nd");
    expect(ordinal(93)).toBe("93rd");
  });
});
