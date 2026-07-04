import { describe, it, expect } from "vitest";
import { narrativeOutline } from "@/domain/reports/narrative";
import { parseNarrativeResponse } from "@/domain/reports/narrative-parse";
import { healthFromSnapshot, type ReportSnapshot } from "@/domain/reports/metrics";
import type { FlowGraph } from "@/domain/graph/types";

const TODAY = "2026-07-02";

const EMPTY: ReportSnapshot = {
  mdf: { requested: 0, approved: 0, deployed: 0, claimed: 0, reimbursed: 0, remaining: 0, pipeline: 0, roi: null, deadlineRisks: 0, open: 0 },
  ace: { open: 0, openValue: 0, won: 0, wonValue: 0, atRisk: 0, unrouted: 0 },
  evidence: { total: 0, approved: 0, missing: 0, percent: 0 },
  programs: { total: 0, active: 0, pending: 0, expired: 0 },
  tier: null,
  tasks: { total: 0, open: 0, done: 0, overdue: 0 },
  assessments: { count: 0, scored: 0, latestScore: null },
};

function snap(over: Partial<ReportSnapshot>): ReportSnapshot {
  return { ...EMPTY, ...over };
}

// Evidence 80 + Tasks 50 -> two drivers with a clear strongest/weakest split.
const populated = snap({
  evidence: { total: 5, approved: 4, missing: 1, percent: 80 },
  tasks: { total: 4, open: 2, done: 2, overdue: 1 },
  ace: { open: 3, openValue: 250_000, won: 1, wonValue: 90_000, atRisk: 2, unrouted: 1 },
  mdf: { ...EMPTY.mdf, requested: 10_000, approved: 8_000, deadlineRisks: 1, open: 2 },
  tier: { current: "Advanced", target: "Premier", status: "active", met: 5, total: 8, percent: 62 },
});

const GRAPH: FlowGraph = {
  kind: "flow",
  nodes: [
    { id: "mdf", kind: "mdf", label: "MDF", sublabel: "$40k deployed", tone: "ok", column: "source" },
    { id: "ace", kind: "ace", label: "ACE co-sell", sublabel: "5 open", tone: "warn", column: "flow" },
    { id: "tier", kind: "tier", label: "Tier: Premier", sublabel: "62% ready", tone: "danger", column: "sink" },
  ],
  edges: [
    { from: "ace", to: "tier", weight: 0.5, label: "2 launched", tone: "info" },
    { from: "mdf", to: "ace", weight: 0.9, label: "3 backed deals", tone: "ok" },
  ],
};

describe("narrativeOutline", () => {
  it("opens with the snapshot's own health posture as of the injected date", () => {
    const h = healthFromSnapshot(populated);
    const out = narrativeOutline(populated, null, TODAY);
    expect(out).toContain(`As of ${TODAY}, partnership health stands at ${h.score}/100`);
    // Strongest vs weakest driver named (MDF 80 ties Evidence 80; alphabetical tie-break -> Evidence).
    expect(out).toContain("is the strongest driver");
  });

  it("renders the top value-flow chains by edge weight, heaviest first", () => {
    const out = narrativeOutline(populated, GRAPH, TODAY);
    const flow = out.split("\n\n").find((p) => p.startsWith("Where value is flowing:"))!;
    expect(flow).toBeDefined();
    const heavy = flow.indexOf("MDF -> ACE co-sell (3 backed deals)");
    const light = flow.indexOf("ACE co-sell -> Tier: Premier (2 launched)");
    expect(heavy).toBeGreaterThan(-1);
    expect(light).toBeGreaterThan(heavy);
  });

  it("degrades cleanly without a graph: no flow paragraph, story intact", () => {
    const out = narrativeOutline(populated, null, TODAY);
    expect(out).not.toContain("Where value is flowing");
    expect(out).not.toContain("Flagged on the value map");
    expect(out.split("\n\n").length).toBe(3); // posture, risks, trajectory
  });

  it("collects snapshot watch items and warn/danger graph nodes as risks", () => {
    const out = narrativeOutline(populated, GRAPH, TODAY);
    expect(out).toContain("Watch items: 1 MDF deadline risk, 2 at-risk co-sell deals, 1 overdue task, 1 evidence gap.");
    expect(out).toContain("Flagged on the value map: ACE co-sell (5 open); Tier: Premier (62% ready).");
  });

  it("says so plainly when nothing is at risk", () => {
    const calm = snap({ evidence: { total: 2, approved: 2, missing: 0, percent: 100 } });
    expect(narrativeOutline(calm, null, TODAY)).toContain("No acute risks stand out in this snapshot.");
  });

  it("includes the tier trajectory only when a tier plan exists", () => {
    const withTier = narrativeOutline(populated, null, TODAY);
    expect(withTier).toContain("Tier trajectory: Advanced -> Premier, 62% of requirements met (5/8).");
    const noTier = narrativeOutline(snap({ ...populated, tier: null }), null, TODAY);
    expect(noTier).not.toContain("Tier trajectory");
    expect(noTier).toContain("In motion: 3 open opportunities worth $250,000, 2 open MDF requests, 1 unrouted deal.");
  });

  it("is deterministic for a fixed snapshot + graph + date", () => {
    expect(narrativeOutline(populated, GRAPH, TODAY)).toBe(narrativeOutline(populated, GRAPH, TODAY));
  });
});

describe("parseNarrativeResponse", () => {
  it("extracts and clamps the narrative from a JSON reply with surrounding prose", () => {
    const text = `Here you go:\n{"narrative": "${"x".repeat(5000)}"}\nDone.`;
    expect(parseNarrativeResponse(text)).toHaveLength(4000);
    expect(parseNarrativeResponse('{"narrative": "The quarter was strong."}')).toBe("The quarter was strong.");
  });

  it("returns the empty sentinel for malformed or empty replies", () => {
    expect(parseNarrativeResponse("no json here")).toBe("");
    expect(parseNarrativeResponse('{"narrative": ""}')).toBe("");
    expect(parseNarrativeResponse('{"other": 1}')).toBe("");
  });
});
