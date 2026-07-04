import { describe, it, expect } from "vitest";
import { assembleDealDesk, dealMoves, type DealDeskParts, type DealOpp } from "./deal-desk";
import type { ProgramMatch } from "@/domain/funding/eligibility";
import type { FundingProgram } from "@/domain/funding/catalog";
import type { RepHealth } from "@/domain/ace/rep-intelligence";

const TODAY = "2026-07-01";

function opp(over: Partial<DealOpp> = {}): DealOpp {
  return {
    id: "o1",
    name: "Globex migration",
    accountName: "Globex",
    status: "open",
    stage: "business_validation",
    amount: 250_000,
    source: "amazon_originated",
    ownerUserId: "u1",
    nextStep: "Schedule EBC",
    lastInteraction: "2026-01-01", // stale -> at-risk
    closeDate: "2026-09-01",
    routingStatus: "routed",
    ...over,
  };
}

function match(key: string, eligible: boolean, score: number): ProgramMatch {
  return {
    program: { key, name: key.toUpperCase() } as FundingProgram,
    score,
    met: [],
    unmet: [],
    eligible,
    rationale: `${key} rationale`,
  };
}

function rep(over: Partial<RepHealth> = {}): RepHealth {
  return {
    id: "r1", name: "Jane Patel", role: "seller", accountName: "Globex",
    score: 30, band: "weak", recency: 20, strength: 40, momentum: 30,
    daysSinceContact: 72, openCount: 1, openValue: 250_000, wonValue: 0, originated: 1,
    atStake: true, ...over,
  };
}

const emptyMarket = { listings: [], agreements: [], entitlementCount: 0 } as const;

function study(id: string, attached: boolean, score = 40) {
  return { id, title: `Study ${id}`, customerName: "Globex", score, reasons: [], attached };
}

describe("deal desk", () => {
  it("excludes already-applied programs and ranks the rest by score", () => {
    const parts: DealDeskParts = {
      opp: opp(),
      fundingMatches: [match("map", true, 90), match("sif", true, 70), match("poc", false, 40)],
      appliedProgramKeys: ["map"],
      mdf: [],
      marketplace: emptyMarket,
      offers: [],
      awsTeam: [],
      caseStudies: [],
      caseStudyLibraryCount: 0,
    };
    const model = assembleDealDesk(parts, TODAY);
    expect(model.eligibleUnapplied.map((m) => m.program.key)).toEqual(["sif"]); // map applied, poc ineligible
  });

  it("ranks the full move set in priority order", () => {
    const parts: DealDeskParts = {
      opp: opp(), // at-risk + high value
      fundingMatches: [match("map", true, 90)],
      appliedProgramKeys: [],
      mdf: [], // none -> mdf move
      marketplace: { listings: [{ id: "l1", title: "Acme Analytics", status: "published" }], agreements: [], entitlementCount: 0 },
      offers: [], // published listing, no offer -> "Draft a private offer" marketplace move
      awsTeam: [rep()], // atStake -> rep move
      caseStudies: [study("cs1", false)], // relevant + unpinned -> proof move
      caseStudyLibraryCount: 1,
    };
    const moves = dealMoves(parts, TODAY);
    expect(moves.map((m) => m.kind)).toEqual(["deal", "rep", "funding", "mdf", "marketplace", "proof"]);
    expect(moves[0]!.priority).toBe(100);
  });

  it("surfaces nothing when the deal is healthy and fully covered", () => {
    const parts: DealDeskParts = {
      opp: opp({ lastInteraction: TODAY, amount: 20_000 }), // recent + low value -> not at-risk-highvalue
      fundingMatches: [match("map", true, 90)],
      appliedProgramKeys: ["map"], // applied
      mdf: [{ id: "m1", title: "Re:Invent booth", status: "approved", requestedAmount: 10_000, approvedAmount: 8_000 }],
      marketplace: emptyMarket, // no published listing
      offers: [],
      awsTeam: [rep({ atStake: false, score: 80, band: "strong" })],
      caseStudies: [study("cs1", true)], // pinned -> proof move suppressed
      caseStudyLibraryCount: 1,
    };
    expect(dealMoves(parts, TODAY)).toHaveLength(0);
  });

  it("suppresses the proof move when no matches exist or the deal is not open", () => {
    const base: Omit<DealDeskParts, "caseStudies" | "opp"> = {
      fundingMatches: [],
      appliedProgramKeys: [],
      mdf: [{ id: "m1", title: "x", status: "approved", requestedAmount: 1, approvedAmount: 1 }],
      marketplace: emptyMarket,
      offers: [],
      awsTeam: [],
      caseStudyLibraryCount: 3,
    };
    const healthyOpp = opp({ lastInteraction: TODAY, amount: 20_000 });
    expect(dealMoves({ ...base, opp: healthyOpp, caseStudies: [] }, TODAY)).toHaveLength(0);
    expect(
      dealMoves({ ...base, opp: opp({ ...healthyOpp, status: "won" }), caseStudies: [study("cs1", false)] }, TODAY),
    ).toHaveLength(0);
    const withMatch = dealMoves({ ...base, opp: healthyOpp, caseStudies: [study("cs1", false)] }, TODAY);
    expect(withMatch.map((m) => m.kind)).toEqual(["proof"]);
    expect(withMatch[0]!.link).toBe("#case-studies");
  });
});
