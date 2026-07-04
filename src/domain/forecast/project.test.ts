import { describe, it, expect } from "vitest";
import {
  normalizeDeltas,
  linearProjection,
  monteCarloProjection,
  roadmapCompletionMC,
  seedFrom,
  MIN_POINTS,
  type SeriesPoint,
} from "@/domain/forecast/project";

/** A daily rising series: value = 100 + 10/day, n points ending 2026-06-30. */
function rising(n: number, step = 10): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 5, 30 - (n - 1 - i)));
    out.push({ capturedOn: d.toISOString().slice(0, 10), value: 100 + i * step });
  }
  return out;
}

const SEED = seedFrom("tenant-a:2026-07-01");

describe("normalizeDeltas", () => {
  it("divides each step by its elapsed-day gap (on-visit capture gaps)", () => {
    const deltas = normalizeDeltas([
      { capturedOn: "2026-06-01", value: 100 },
      { capturedOn: "2026-06-02", value: 110 }, // +10 over 1d
      { capturedOn: "2026-06-05", value: 140 }, // +30 over 3d -> 10/day
    ]);
    expect(deltas).toEqual([10, 10]);
  });

  it("skips duplicate-date pairs and sorts unordered input", () => {
    const deltas = normalizeDeltas([
      { capturedOn: "2026-06-03", value: 120 },
      { capturedOn: "2026-06-01", value: 100 },
      { capturedOn: "2026-06-03", value: 120 }, // duplicate date -> skipped pair
    ]);
    expect(deltas).toEqual([10]); // (120-100)/2
  });
});

describe("linearProjection", () => {
  it("extends the average slope across the horizon", () => {
    const p = linearProjection(rising(6), { horizonDays: 3 })!;
    expect(p.slopePerDay).toBe(10);
    expect(p.projected).toHaveLength(3);
    expect(p.projected[0]).toEqual({ capturedOn: "2026-07-01", value: 160 });
    expect(p.projected[2]!.value).toBe(180);
  });

  it("returns null under MIN_POINTS and clamps to the floor", () => {
    expect(linearProjection(rising(MIN_POINTS - 1), { horizonDays: 5 })).toBeNull();
    const falling = rising(6, -30); // steep decline crosses zero
    const p = linearProjection(falling, { horizonDays: 10 })!;
    expect(p.projected.every((pt) => pt.value >= 0)).toBe(true);
  });
});

describe("monteCarloProjection", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    // Wobbly series: distinct deltas so different seeds genuinely diverge.
    const wobble = rising(10).map((p, i) => ({ ...p, value: p.value + (i % 4) * 7 }));
    const a = monteCarloProjection(wobble, { horizonDays: 30, seed: SEED })!;
    const b = monteCarloProjection(wobble, { horizonDays: 30, seed: SEED })!;
    expect(a).toEqual(b);
    const c = monteCarloProjection(wobble, { horizonDays: 30, seed: SEED + 1 })!;
    expect(c.band).not.toEqual(a.band);
  });

  it("keeps the band ordered p10 <= p50 <= p90 across the whole horizon", () => {
    // A wobbly series so the band has real width.
    const wobble = rising(14).map((p, i) => ({ ...p, value: p.value + (i % 3) * 8 - 8 }));
    const m = monteCarloProjection(wobble, { horizonDays: 45, seed: SEED })!;
    expect(m.band).toHaveLength(45);
    for (const bp of m.band) {
      expect(bp.p10).toBeLessThanOrEqual(bp.p50);
      expect(bp.p50).toBeLessThanOrEqual(bp.p90);
    }
    expect(m.terminal.p50).toBe(m.band[44]!.p50);
  });

  it("a flat series projects a flat band (all deltas zero)", () => {
    const flat = rising(8, 0);
    const m = monteCarloProjection(flat, { horizonDays: 10, seed: SEED })!;
    expect(m.band.every((bp) => bp.p10 === 100 && bp.p50 === 100 && bp.p90 === 100)).toBe(true);
  });

  it("respects floor and cap clamps and MIN_POINTS", () => {
    const falling = rising(8, -50);
    const m = monteCarloProjection(falling, { horizonDays: 20, seed: SEED })!;
    expect(m.band.every((bp) => bp.p10 >= 0)).toBe(true);
    const capped = monteCarloProjection(rising(8, 25), { horizonDays: 20, seed: SEED, cap: 400 })!;
    expect(capped.band.every((bp) => bp.p90 <= 400)).toBe(true);
    expect(monteCarloProjection(rising(2), { horizonDays: 10, seed: SEED })).toBeNull();
  });
});

describe("roadmapCompletionMC", () => {
  // done: 0..6 over 7 daily points ending 2026-06-30 (~1 milestone/day), total 12.
  const burnup = rising(7, 1).map((p, i) => ({ capturedOn: p.capturedOn, value: i }));

  it("projects P50/P90 completion dates and a plannedEnd hit probability in [0,1]", () => {
    const f = roadmapCompletionMC(burnup, 12, "2026-07-01", { seed: SEED, plannedEnd: "2026-07-20" })!;
    expect(f.p50Date).not.toBeNull();
    expect(f.p90Date).not.toBeNull();
    expect(f.p50Date! <= f.p90Date!).toBe(true);
    expect(f.hitProbability).toBeGreaterThanOrEqual(0);
    expect(f.hitProbability).toBeLessThanOrEqual(1);
    // ~1/day pace, 6 remaining, 19 days of runway -> should be very likely.
    expect(f.hitProbability!).toBeGreaterThan(0.5);
  });

  it("a stalled roadmap (zero velocity) never completes: null dates, probability 0", () => {
    const stalled = rising(7, 0).map((p) => ({ capturedOn: p.capturedOn, value: 3 }));
    const f = roadmapCompletionMC(stalled, 12, "2026-07-01", { seed: SEED, plannedEnd: "2026-08-01" })!;
    expect(f.p50Date).toBeNull();
    expect(f.p90Date).toBeNull();
    expect(f.hitProbability).toBe(0);
  });

  it("an already-complete roadmap resolves to today; insufficient history is null", () => {
    const doneAll = rising(7, 1).map((p, i) => ({ capturedOn: p.capturedOn, value: 6 + i }));
    const f = roadmapCompletionMC(doneAll, 12, "2026-07-01", { seed: SEED, plannedEnd: "2026-08-01" })!;
    expect(f.p50Date).toBe("2026-07-01");
    expect(f.hitProbability).toBe(1);
    expect(roadmapCompletionMC(burnup.slice(0, 3), 12, "2026-07-01", { seed: SEED })).toBeNull();
  });
});
