import { describe, it, expect } from "vitest";
import { buildAttributionGraph, type AttributionExtra } from "@/domain/graph/attribution";
import { renewalReadiness } from "@/domain/solutions/renewal";
import { roiRollup, type ProgramRoi } from "@/domain/programs/roi";
import type { ProgramRoiListItem } from "@/domain/programs/roi-load";
import type { CommandInputs } from "@/domain/command/types";

const TODAY = "2026-06-23";

const EMPTY: CommandInputs = {
  tasks: [],
  mdf: [],
  opportunities: [],
  programs: [],
  evidence: [],
  tier: null,
  tierRequirements: [],
  relationships: [],
  milestones: [],
  solutions: [],
  currentTier: "advanced",
};
function inputs(over: Partial<CommandInputs>): CommandInputs {
  return { ...EMPTY, ...over };
}

function roi(over: Partial<ProgramRoi> = {}): ProgramRoi {
  return {
    attributedCount: 0,
    openCount: 0,
    openTCV: 0,
    wonCount: 0,
    wonTCV: 0,
    launchedCount: 0,
    launchedTCV: 0,
    influencedWonCount: null,
    influencedWonTCV: 0,
    ...over,
  };
}
function competency(id: string, name: string, r: ProgramRoi): ProgramRoiListItem {
  return { id, name, status: "active", achievedAt: null, roi: r };
}

const NO_EXTRA: AttributionExtra = { competencies: [], listings: [] };
const tier = { currentTier: "select", targetTier: "advanced", status: "in_progress" };
const launchedOpp = {
  id: "o1", name: "Launched deal", status: "won" as const, stage: "launched" as const, amount: 90_000,
  source: "amazon_originated" as const, ownerUserId: "u1", nextStep: "", lastInteraction: "2026-06-01",
  closeDate: "2026-05-01", routingStatus: "routed" as const, accountName: "Acme", awsContactId: null,
};

describe("buildAttributionGraph", () => {
  it("an empty workspace has just the ACE hub and no edges", () => {
    const g = buildAttributionGraph(EMPTY, NO_EXTRA, TODAY);
    expect(g.nodes.some((n) => n.id === "ace")).toBe(true);
    expect(g.edges).toHaveLength(0);
  });

  it("routes launched opportunities to the tier requirement", () => {
    const g = buildAttributionGraph(inputs({ tier, opportunities: [launchedOpp] }), NO_EXTRA, TODAY);
    const e = g.edges.find((x) => x.from === "ace" && x.to === "tier");
    expect(e?.label).toBe("1 launched");
  });

  it("adds a Funding source node when approved funding is present (ROI loop)", () => {
    const g = buildAttributionGraph(
      inputs({ opportunities: [launchedOpp] }),
      { competencies: [], listings: [], funding: { approved: 40_000 } },
      TODAY,
    );
    expect(g.nodes.find((n) => n.id === "funding")?.label).toBe("AWS Funding");
    expect(g.edges.find((e) => e.from === "funding" && e.to === "ace")?.label).toBe("$40,000");
  });

  it("adds rep source nodes for relationships with closed deals (win/loss mining)", () => {
    const rel = { id: "r1", name: "Jane Patel", role: "seller" as const, accountName: "Acme", strength: 80, lastContact: "2026-06-01" };
    const wonOpp = { ...launchedOpp, awsContactId: "r1" };
    const g = buildAttributionGraph(inputs({ relationships: [rel], opportunities: [wonOpp] }), NO_EXTRA, TODAY);
    const node = g.nodes.find((n) => n.id === "rep-r1");
    expect(node?.kind).toBe("rep");
    expect(node?.sublabel).toBe("100% wins · $90,000");
    expect(node?.tone).toBe("ok");
    expect(g.edges.find((e) => e.from === "rep-r1" && e.to === "ace")?.label).toBe("1 won");
    // No closed deals attributed -> no rep node.
    const g2 = buildAttributionGraph(inputs({ relationships: [rel] }), NO_EXTRA, TODAY);
    expect(g2.nodes.some((n) => n.kind === "rep")).toBe(false);
  });

  it("wires ACE → competency → attributed revenue with the ROI numbers", () => {
    const comps = [
      competency("c1", "Migration", roi({ attributedCount: 3, wonCount: 2, wonTCV: 120_000 })),
      competency("c2", "DevOps", roi({ attributedCount: 1, wonCount: 1, wonTCV: 80_000 })),
    ];
    const g = buildAttributionGraph(EMPTY, { competencies: comps, listings: [] }, TODAY);

    expect(g.edges.find((e) => e.from === "ace" && e.to === "comp-c1")?.label).toBe("3 opps");
    expect(g.edges.find((e) => e.from === "comp-c1" && e.to === "roi")?.label).toBe("$120,000");
    // ROI sink total equals roiRollup wonTCV.
    const total = roiRollup(comps.map((c) => ({ name: c.name, roi: c.roi }))).wonTCV;
    expect(g.nodes.find((n) => n.id === "roi")?.sublabel).toBe(`${`$${total.toLocaleString()}`} won`);
    // The bigger competency has the heavier money edge.
    const w1 = g.edges.find((e) => e.from === "comp-c1" && e.to === "roi")?.weight ?? 0;
    const w2 = g.edges.find((e) => e.from === "comp-c2" && e.to === "roi")?.weight ?? 0;
    expect(w1).toBeGreaterThan(w2);
  });

  it("competencies with no attributed deals are excluded", () => {
    const g = buildAttributionGraph(EMPTY, { competencies: [competency("c9", "Idle", roi())], listings: [] }, TODAY);
    expect(g.nodes.some((n) => n.id === "comp-c9")).toBe(false);
    expect(g.nodes.some((n) => n.id === "roi")).toBe(false);
  });

  it("tones the Specializations node by the worst renewal band", () => {
    const sol = {
      id: "s1", title: "Widget", availability: "available", programType: "Foundational",
      solutionType: "software", ftrStatus: "pending", launchedCount: 0, renewalDate: null,
    };
    const band = renewalReadiness({ ...sol, currentTier: "advanced" }, TODAY).band;
    const g = buildAttributionGraph(inputs({ solutions: [sol], currentTier: "advanced" }), NO_EXTRA, TODAY);
    const node = g.nodes.find((n) => n.id === "solutions");
    expect(node?.tone).toBe(band === "compliant" ? "ok" : band === "at_risk" ? "warn" : "danger");
  });

  it("draws marketplace → solutions only for listings that link a solution", () => {
    const sol = {
      id: "s1", title: "Widget", availability: "available", programType: "Foundational",
      solutionType: "professional_services", ftrStatus: "approved", launchedCount: 2, renewalDate: null,
    };
    const withLink: AttributionExtra = {
      competencies: [],
      listings: [{ id: "l1", title: "L1", solutionId: "s1", published: true }, { id: "l2", title: "L2", solutionId: null, published: false }],
    };
    const g = buildAttributionGraph(inputs({ solutions: [sol] }), withLink, TODAY);
    expect(g.nodes.some((n) => n.id === "marketplace")).toBe(true);
    expect(g.edges.find((e) => e.from === "marketplace" && e.to === "solutions")?.label).toBe("1 linked");

    const noLink: AttributionExtra = { competencies: [], listings: [{ id: "l3", title: "L3", solutionId: null, published: true }] };
    const g2 = buildAttributionGraph(inputs({ solutions: [sol] }), noLink, TODAY);
    expect(g2.edges.some((e) => e.from === "marketplace" && e.to === "solutions")).toBe(false);
  });
});
