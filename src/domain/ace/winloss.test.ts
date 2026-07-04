import { describe, it, expect } from "vitest";
import {
  mineWinLoss,
  repWinRows,
  strengthSplit,
  MIN_SAMPLE,
  type ClosedDeal,
  type RepWinRel,
  type RepWinOpp,
} from "@/domain/ace/winloss";

function deal(over: Partial<ClosedDeal> = {}): ClosedDeal {
  return {
    id: "d1",
    name: "Deal",
    status: "won",
    amount: 100_000,
    source: "partner_originated",
    stage: "committed",
    lossReason: "",
    createdAt: "2026-01-01",
    closedAt: "2026-03-01",
    hasMdf: false,
    hasFunding: false,
    hasOffer: false,
    hasAwsTeam: false,
    hasCompetency: false,
    hasSolution: false,
    ...over,
  };
}

describe("mineWinLoss", () => {
  it("computes overall stats + cycle time over won deals with a close stamp", () => {
    const r = mineWinLoss([
      deal({ id: "a", status: "won", amount: 100_000, createdAt: "2026-01-01", closedAt: "2026-01-31" }), // 30d
      deal({ id: "b", status: "won", amount: 50_000, createdAt: "2026-01-01", closedAt: "2026-03-12" }), // 70d
      deal({ id: "c", status: "lost", amount: 80_000, lossReason: "price" }),
      deal({ id: "d", status: "won", closedAt: null }), // no stamp -> excluded from cycle
    ]);
    expect(r.overall).toMatchObject({ closed: 4, won: 3, lost: 1, winRate: 75, lostTCV: 80_000 });
    expect(r.overall.wonTCV).toBe(250_000);
    expect(r.overall.avgCycleDays).toBe(50); // (30 + 70) / 2
  });

  it("returns null win rate + cycle when nothing closed / no stamps", () => {
    expect(mineWinLoss([]).overall.winRate).toBeNull();
    expect(mineWinLoss([deal({ closedAt: null })]).overall.avgCycleDays).toBeNull();
  });

  it("builds source + size-band cohorts, dropping empty ones", () => {
    const r = mineWinLoss([
      deal({ id: "a", source: "amazon_originated", amount: 300_000, status: "won" }),
      deal({ id: "b", source: "amazon_originated", amount: 260_000, status: "lost" }),
      deal({ id: "c", source: "partner_originated", amount: 40_000, status: "lost" }),
    ]);
    const amazon = r.bySource.find((c) => c.key === "amazon_originated");
    expect(amazon).toMatchObject({ closed: 2, won: 1, winRate: 50, wonTCV: 300_000 });
    expect(r.bySource.some((c) => c.key === "marketplace")).toBe(false); // empty -> dropped
    expect(r.bySizeBand.map((c) => c.key)).toEqual(["small", "large"]); // no mid-band deals
  });

  it("breaks down loss reasons (skipping unrecorded) + stage at loss", () => {
    const r = mineWinLoss([
      deal({ id: "a", status: "lost", lossReason: "competitor", amount: 100_000, stage: "business_validation" }),
      deal({ id: "b", status: "lost", lossReason: "competitor", amount: 50_000, stage: "qualified" }),
      deal({ id: "c", status: "lost", lossReason: "price", amount: 200_000, stage: "business_validation" }),
      deal({ id: "d", status: "lost", lossReason: "", amount: 10_000, stage: "prospect" }), // unrecorded
    ]);
    expect(r.lossReasons[0]).toMatchObject({ reason: "competitor", count: 2, lostTCV: 150_000 });
    expect(r.lossReasons.some((x) => x.reason === "")).toBe(false);
    expect(r.stageAtLoss[0]).toMatchObject({ stage: "business_validation", count: 2 });
  });

  it("computes factor lifts with vs without", () => {
    // 4 MDF-backed deals (3 won) vs 4 un-backed (1 won) -> 75% vs 25% -> 3x lift.
    const deals = [
      ...[1, 2, 3].map((i) => deal({ id: `w${i}`, hasMdf: true, status: "won" })),
      deal({ id: "l1", hasMdf: true, status: "lost" }),
      deal({ id: "w4", hasMdf: false, status: "won" }),
      ...[1, 2, 3].map((i) => deal({ id: `l${i + 1}`, hasMdf: false, status: "lost" })),
    ];
    const mdf = mineWinLoss(deals).factors.find((f) => f.key === "mdf")!;
    expect(mdf).toMatchObject({ withWinRate: 75, withoutWinRate: 25, lift: 3, nWith: 4, nWithout: 4, suppressed: false });
  });

  it("suppresses factors with fewer than MIN_SAMPLE per side", () => {
    const deals = [
      deal({ id: "a", hasFunding: true, status: "won" }), // only 1 funding-backed
      ...[1, 2, 3].map((i) => deal({ id: `n${i}`, hasFunding: false })),
    ];
    const funding = mineWinLoss(deals).factors.find((f) => f.key === "funding")!;
    expect(funding.nWith).toBeLessThan(MIN_SAMPLE);
    expect(funding.suppressed).toBe(true);
  });
});

const rels: RepWinRel[] = [
  { id: "r1", name: "Jane", role: "seller", accountName: "Globex", strength: 80 },
  { id: "r2", name: "Raj", role: "solutions_architect", accountName: "Initech", strength: 40 },
  { id: "r3", name: "Quiet", role: "seller", accountName: "Nowhere", strength: 90 },
];

const opps: RepWinOpp[] = [
  { status: "won", amount: 200_000, accountName: "Globex", awsContactId: "r1" }, // direct
  { status: "lost", amount: 50_000, accountName: "Globex", awsContactId: null }, // account fallback -> r1
  { status: "won", amount: 90_000, accountName: "Initech", awsContactId: "r2" },
  { status: "lost", amount: 40_000, accountName: "Initech", awsContactId: "r2" },
  { status: "open", amount: 999_999, accountName: "Globex", awsContactId: "r1" }, // open -> ignored
];

describe("repWinRows + strengthSplit", () => {
  it("attributes closed deals via awsContactId + account fallback, sorted by won TCV", () => {
    const rows = repWinRows(rels, opps);
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]); // r3 has no closed deals
    expect(rows[0]).toMatchObject({ id: "r1", closed: 2, won: 1, winRate: 50, wonTCV: 200_000 });
    expect(rows[1]).toMatchObject({ id: "r2", closed: 2, won: 1, winRate: 50, wonTCV: 90_000 });
  });

  it("splits win rate by relationship strength", () => {
    const s = strengthSplit(rels, opps);
    expect(s).toMatchObject({ strongClosed: 2, weakClosed: 2, strongWinRate: 50, weakWinRate: 50 });
    // Make strong clearly better: an extra strong-rel win.
    const s2 = strengthSplit(rels, [...opps, { status: "won", amount: 10, accountName: "Globex", awsContactId: "r1" }]);
    expect(s2.strongWinRate).toBe(67);
  });
});
