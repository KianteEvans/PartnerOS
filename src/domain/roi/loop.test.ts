import { describe, it, expect } from "vitest";
import { spendRoi, roiLoop, sortSpend, type SpendRecord, type LinkedOpp } from "./loop";

function rec(over: Partial<SpendRecord>): SpendRecord {
  return {
    kind: over.kind ?? "mdf",
    id: over.id ?? "s",
    title: over.title ?? "Spend",
    approved: over.approved ?? 10000,
    expectedPipeline: over.expectedPipeline ?? 0,
    opportunityId: over.opportunityId ?? null,
  };
}

function opp(over: Partial<LinkedOpp>): LinkedOpp {
  return {
    id: over.id ?? "o",
    name: over.name ?? "Deal",
    status: over.status ?? "open",
    stage: over.stage ?? "qualified",
    amount: over.amount ?? 100000,
  };
}

describe("spendRoi", () => {
  it("attributes a won launched deal as realized revenue + tier credit", () => {
    const r = spendRoi(
      rec({ approved: 40000, expectedPipeline: 220000, opportunityId: "o1" }),
      opp({ id: "o1", status: "won", stage: "launched", amount: 250000 }),
    );
    expect(r.influencedWon).toBe(250000);
    expect(r.influencedOpen).toBe(0);
    expect(r.launched).toBe(true);
    expect(r.realizedRoi).toBe(6.25); // 250000 / 40000
    expect(r.expectedRoi).toBe(5.5); // 220000 / 40000
  });

  it("an open deal is influenced pipeline, not yet realized", () => {
    const r = spendRoi(rec({ approved: 15000, opportunityId: "o2" }), opp({ id: "o2", status: "open", amount: 90000 }));
    expect(r.influencedOpen).toBe(90000);
    expect(r.influencedWon).toBe(0);
    expect(r.realizedRoi).toBe(0);
    expect(r.launched).toBe(false);
  });

  it("an unlinked spend record realizes nothing", () => {
    const r = spendRoi(rec({ approved: 10000, opportunityId: null }), null);
    expect(r.opp).toBeNull();
    expect(r.influencedOpen).toBe(0);
    expect(r.influencedWon).toBe(0);
    expect(r.realizedRoi).toBe(0);
  });

  it("guards a zero-approved denominator (ROI null)", () => {
    const r = spendRoi(rec({ approved: 0, expectedPipeline: 50000, opportunityId: "o" }), opp({ id: "o", status: "won", amount: 80000 }));
    expect(r.realizedRoi).toBeNull();
    expect(r.expectedRoi).toBeNull();
  });
});

describe("roiLoop funnel", () => {
  const records: SpendRecord[] = [
    rec({ kind: "mdf", id: "m1", approved: 40000, expectedPipeline: 220000, opportunityId: "o1" }),
    rec({ kind: "funding", id: "f1", approved: 15000, opportunityId: "o2" }),
    rec({ kind: "mdf", id: "m2", approved: 10000, expectedPipeline: 50000, opportunityId: null }),
    rec({ kind: "funding", id: "f2", approved: 5000, opportunityId: "missing" }),
  ];
  const oppsById = new Map<string, LinkedOpp>([
    ["o1", opp({ id: "o1", status: "won", stage: "launched", amount: 250000 })],
    ["o2", opp({ id: "o2", status: "open", stage: "qualified", amount: 90000 })],
  ]);

  it("rolls spend -> pipeline -> won -> tier credit with leaks", () => {
    const f = roiLoop(records, oppsById);
    expect(f.approvedSpend).toBe(70000);
    expect(f.expectedPipeline).toBe(270000);
    expect(f.influencedOpen).toBe(90000);
    expect(f.influencedWon).toBe(250000);
    expect(f.realizedRoi).toBe(3.57); // 250000 / 70000
    expect(f.expectedRoi).toBe(3.86); // 270000 / 70000
    expect(f.launchedCredits).toBe(1); // o1 launched
    expect(f.unlinkedSpend).toBe(15000); // m2 (null) + f2 (missing id)
    expect(f.inFlightCount).toBe(1); // o2 open
    expect(f.records).toHaveLength(4);
  });
});

describe("sortSpend", () => {
  it("surfaces leaks first: unlinked, then in-flight, then worst realized ROI", () => {
    const rows = roiLoop(
      [
        rec({ id: "won", approved: 40000, opportunityId: "w" }),
        rec({ id: "open", approved: 15000, opportunityId: "p" }),
        rec({ id: "none", approved: 10000, opportunityId: null }),
      ],
      new Map([
        ["w", opp({ id: "w", status: "won", amount: 250000 })],
        ["p", opp({ id: "p", status: "open", amount: 90000 })],
      ]),
    ).records;
    expect(sortSpend(rows).map((r) => r.id)).toEqual(["none", "open", "won"]);
  });
});
