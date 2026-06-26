import { describe, it, expect } from "vitest";
import {
  recencyScore,
  momentumScore,
  healthBand,
  repHealth,
  computeRepHealth,
  repHealthSummary,
  RECENCY_WINDOW_DAYS,
  type RepRelationship,
  type RepOpp,
} from "@/domain/ace/rep-intelligence";

const TODAY = "2026-06-24";
const rel = (over: Partial<RepRelationship> = {}): RepRelationship => ({
  id: "r1",
  name: "Jordan AE",
  role: "seller",
  accountName: "Acme",
  strength: 50,
  lastContact: TODAY,
  ...over,
});
const opp = (over: Partial<RepOpp> = {}): RepOpp => ({
  accountName: "Acme",
  status: "open",
  amount: 0,
  source: "partner_originated",
  awsContactId: null,
  ...over,
});

describe("recencyScore", () => {
  it("is 100 when contacted today, 0 when never contacted", () => {
    expect(recencyScore(TODAY, TODAY)).toBe(100);
    expect(recencyScore(null, TODAY)).toBe(0);
  });
  it("decays linearly to 0 at the window edge", () => {
    expect(recencyScore("2026-05-25", TODAY)).toBe(50); // 30 days → half
    expect(recencyScore("2026-04-25", TODAY)).toBe(0); // 60 days → 0
    expect(recencyScore("2026-01-01", TODAY)).toBe(0); // older → clamped 0
  });
  it("uses RECENCY_WINDOW_DAYS as the floor", () => {
    expect(RECENCY_WINDOW_DAYS).toBe(60);
  });
});

describe("momentumScore", () => {
  it("rewards open pipeline, capped at 50", () => {
    expect(momentumScore([opp({ amount: 100_000 })])).toBe(10); // 100k/10k
    expect(momentumScore([opp({ amount: 9_999_999 })])).toBe(50); // capped
  });
  it("adds win-rate points over closed deals", () => {
    // 2 won, 0 lost → 100% win rate → 30 pts; no open pipeline
    expect(momentumScore([opp({ status: "won" }), opp({ status: "won" })])).toBe(30);
    // 1 won, 1 lost → 50% → 15 pts
    expect(momentumScore([opp({ status: "won" }), opp({ status: "lost" })])).toBe(15);
  });
  it("adds origination points, capped at 20", () => {
    expect(momentumScore([opp({ source: "amazon_originated" })])).toBe(10);
    expect(
      momentumScore([
        opp({ source: "amazon_originated" }),
        opp({ source: "amazon_originated" }),
        opp({ source: "amazon_originated" }),
      ]),
    ).toBe(20); // 3 → capped
  });
  it("is 0 with no opportunities", () => {
    expect(momentumScore([])).toBe(0);
  });
});

describe("healthBand", () => {
  it("maps scores to bands at the thresholds", () => {
    expect(healthBand(80)).toBe("strong");
    expect(healthBand(75)).toBe("strong");
    expect(healthBand(60)).toBe("healthy");
    expect(healthBand(45)).toBe("fair");
    expect(healthBand(25)).toBe("weak");
    expect(healthBand(24)).toBe("dormant");
    expect(healthBand(0)).toBe("dormant");
  });
});

describe("repHealth", () => {
  it("scores a recent, strong contact with live pipeline as strong", () => {
    const h = repHealth(
      rel({ strength: 80, lastContact: TODAY }),
      [opp({ amount: 200_000 }), opp({ status: "won", source: "amazon_originated" })],
      TODAY,
    );
    // recency 100, strength 80, momentum = 20(pipeline) + 30(win) + 10(orig) = 60
    // 0.4*100 + 0.3*80 + 0.3*60 = 40 + 24 + 18 = 82
    expect(h.recency).toBe(100);
    expect(h.momentum).toBe(60);
    expect(h.score).toBe(82);
    expect(h.band).toBe("strong");
    expect(h.atStake).toBe(false);
    expect(h.openValue).toBe(200_000);
    expect(h.originated).toBe(1);
  });

  it("flags a strong-but-cold contact with pipeline as at-risk", () => {
    const h = repHealth(
      rel({ strength: 90, lastContact: "2026-03-01" }), // ~115 days → recency 0
      [opp({ amount: 300_000 })],
      TODAY,
    );
    // recency 0, strength 90, momentum 30 → 0 + 27 + 9 = 36 → weak
    expect(h.recency).toBe(0);
    expect(h.score).toBe(36);
    expect(h.band).toBe("weak");
    expect(h.atStake).toBe(true); // open pipeline + score < 45
    expect(h.openValue).toBe(300_000);
  });

  it("matches the account case/space-insensitively and ignores other accounts", () => {
    const h = repHealth(rel({ accountName: " Acme " }), [
      opp({ accountName: "ACME", amount: 50_000 }),
      opp({ accountName: "Globex", amount: 999_000 }), // different account, excluded
    ], TODAY);
    expect(h.openValue).toBe(50_000);
  });

  it("counts directly-linked opps and excludes opps linked to another rep", () => {
    const h = repHealth(
      rel({ id: "r1", accountName: "Acme" }),
      [
        opp({ accountName: "Other", amount: 70_000, awsContactId: "r1" }), // linked → counts despite different account
        opp({ accountName: "Acme", amount: 999_000, awsContactId: "r2" }), // account matches but linked elsewhere → excluded
      ],
      TODAY,
    );
    expect(h.openValue).toBe(70_000);
  });

  it("never marks a contact with no open pipeline as at-risk", () => {
    const h = repHealth(rel({ lastContact: null, strength: 0 }), [], TODAY);
    expect(h.band).toBe("dormant");
    expect(h.atStake).toBe(false); // dormant but nothing at stake
  });
});

describe("computeRepHealth ordering", () => {
  it("surfaces at-risk relationships first, by pipeline size", () => {
    const rels = [
      rel({ id: "healthy", name: "Healthy", accountName: "Acme", strength: 80, lastContact: TODAY }),
      rel({ id: "small-risk", name: "SmallRisk", accountName: "Beta", strength: 80, lastContact: "2026-01-01" }),
      rel({ id: "big-risk", name: "BigRisk", accountName: "Gamma", strength: 80, lastContact: "2026-01-01" }),
    ];
    const opps = [
      opp({ accountName: "Acme", amount: 100_000 }),
      opp({ accountName: "Beta", amount: 50_000 }),
      opp({ accountName: "Gamma", amount: 400_000 }),
    ];
    const order = computeRepHealth(rels, opps, TODAY).map((h) => h.id);
    expect(order).toEqual(["big-risk", "small-risk", "healthy"]);
  });
});

describe("repHealthSummary", () => {
  it("aggregates bands, average, and pipeline at risk", () => {
    const rels = [
      rel({ id: "a", accountName: "Acme", strength: 80, lastContact: TODAY }),
      rel({ id: "b", accountName: "Gamma", strength: 80, lastContact: "2026-01-01" }),
    ];
    const opps = [
      opp({ accountName: "Acme", amount: 100_000 }),
      opp({ accountName: "Gamma", amount: 400_000 }),
    ];
    const s = repHealthSummary(computeRepHealth(rels, opps, TODAY));
    expect(s.total).toBe(2);
    expect(s.atRiskCount).toBe(1);
    expect(s.pipelineAtRisk).toBe(400_000);
    expect(s.byBand.weak + s.byBand.dormant).toBe(1);
  });
  it("is safe on an empty set", () => {
    const s = repHealthSummary([]);
    expect(s).toEqual({
      total: 0,
      avgScore: 0,
      byBand: { strong: 0, healthy: 0, fair: 0, weak: 0, dormant: 0 },
      atRiskCount: 0,
      pipelineAtRisk: 0,
    });
  });
});
