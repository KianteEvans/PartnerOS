import { describe, it, expect } from "vitest";
import { buildQbrPacket, type QbrMove } from "@/domain/reports/qbr";
import type { ReportSnapshot } from "@/domain/reports/metrics";
import type { TierPath } from "@/domain/tiers/path";

function snap(over: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    mdf: {
      requested: 100000,
      approved: 90000,
      deployed: 80000,
      claimed: 70000,
      reimbursed: 60000,
      remaining: 10000,
      pipeline: 500000,
      roi: 3,
      deadlineRisks: 0,
      open: 2,
    },
    ace: { open: 5, openValue: 500000, won: 3, wonValue: 300000, atRisk: 1, unrouted: 0 },
    evidence: { total: 10, approved: 8, missing: 2, percent: 80 },
    programs: { total: 5, active: 4, pending: 1, expired: 0 },
    tier: { current: "select", target: "advanced", status: "in_progress", met: 6, total: 8, percent: 75 },
    tasks: { total: 10, open: 4, done: 6, overdue: 0 },
    assessments: { count: 2, scored: 2, latestScore: 82 },
    ...over,
  };
}

// A weaker prior quarter so the health arc shows improvement.
const PRIOR = snap({
  ace: { open: 5, openValue: 400000, won: 2, wonValue: 200000, atRisk: 3, unrouted: 1 },
  evidence: { total: 10, approved: 6, missing: 4, percent: 60 },
  programs: { total: 5, active: 2, pending: 2, expired: 1 },
  tier: { current: "select", target: "advanced", status: "in_progress", met: 4, total: 8, percent: 50 },
  tasks: { total: 10, open: 4, done: 6, overdue: 2 },
  mdf: {
    requested: 100000,
    approved: 50000,
    deployed: 40000,
    claimed: 30000,
    reimbursed: 20000,
    remaining: 50000,
    pipeline: 300000,
    roi: 1,
    deadlineRisks: 1,
    open: 3,
  },
});

const MOVES: QbrMove[] = [
  { title: "Meet tier requirement: Certifications", detail: "1/2 toward Advanced.", link: "/programs/tiers" },
  { title: "Renew expiring evidence: Migration case study", detail: "Expires 2026-08-01.", link: "/programs/evidence" },
  { title: "Advance at-risk deal: Acme migration", detail: "$120,000 — stale.", link: "/ace?tab=opportunities" },
  { title: "Fourth move that should be dropped", detail: "…", link: "/x" },
];

const PATH: TierPath = {
  achievable: false,
  remaining: 2,
  scenarios: [
    { id: "aggressive", label: "Aggressive", etaDate: "2026-10-15", steps: [] },
    { id: "steady", label: "Steady", etaDate: "2027-01-15", steps: [] },
    { id: "deliberate", label: "Deliberate", etaDate: "2027-04-15", steps: [] },
  ],
};

describe("buildQbrPacket", () => {
  it("builds a health arc showing period-over-period improvement", () => {
    const p = buildQbrPacket(snap(), PRIOR, MOVES, PATH);
    expect(p.healthArc.current.score).toBe(84);
    expect(p.healthArc.current.band).toBe("strong");
    expect(p.healthArc.priorScore).toBe(48);
    expect(p.healthArc.delta).toBe(36);
    expect(p.healthArc.narrative).toContain("improved");
  });

  it("sets a baseline narrative when there is no prior report", () => {
    const p = buildQbrPacket(snap(), null, MOVES, PATH);
    expect(p.healthArc.priorScore).toBeNull();
    expect(p.healthArc.delta).toBeNull();
    expect(p.healthArc.narrative).toContain("baseline");
    // Every KPI is "new" with no favorable judgement.
    for (const k of p.achieved) {
      expect(k.direction).toBe("new");
      expect(k.favorable).toBeNull();
    }
  });

  it("frames achieved KPIs with direction + favourability, honoring inverted metrics", () => {
    const p = buildQbrPacket(snap(), PRIOR, MOVES, PATH);
    const evidence = p.achieved.find((k) => k.label === "Evidence %");
    expect(evidence).toMatchObject({ current: 80, prior: 60, delta: 20, direction: "up", favorable: true });
    // Fewer overdue tasks is an improvement even though the delta is negative.
    const overdue = p.achieved.find((k) => k.label === "Overdue tasks");
    expect(overdue).toMatchObject({ invert: true, delta: -2, direction: "down", favorable: true });
  });

  it("produces a tier outlook with the steady-scenario ETA and remaining count", () => {
    const p = buildQbrPacket(snap(), PRIOR, MOVES, PATH);
    expect(p.tierOutlook).not.toBeNull();
    expect(p.tierOutlook?.ready).toBe(false);
    expect(p.tierOutlook?.remaining).toBe(2);
    expect(p.tierOutlook?.etaDate).toBe("2027-01-15");
    expect(p.tierOutlook?.narrative).toContain("Advanced");
    expect(p.tierOutlook?.narrative).toContain("2027-01-15");
  });

  it("assembles commitments: tier advance + top-3 moves + open co-sell pipeline", () => {
    const p = buildQbrPacket(snap(), PRIOR, MOVES, PATH);
    // Tier advance first (not ready), then exactly 3 moves, then the ACE commitment.
    expect(p.commitments[0]?.title).toContain("Advance toward Advanced");
    expect(p.commitments.some((c) => c.link === "/ace")).toBe(true);
    // The 4th move is dropped (top-3 only): tier(1) + moves(3) + ace(1) = 5.
    expect(p.commitments).toHaveLength(5);
    expect(p.commitments.some((c) => c.title.includes("Fourth move"))).toBe(false);
    expect(p.headline).toContain("Partnership health 84/100 (strong)");
    expect(p.headline).toContain("Select → Advanced at 75%");
  });

  it("omits the tier-advance commitment and reports readiness when the path is achievable", () => {
    const ready: TierPath = { achievable: true, remaining: 0, scenarios: [] };
    const p = buildQbrPacket(snap(), PRIOR, MOVES, ready);
    expect(p.tierOutlook?.ready).toBe(true);
    expect(p.tierOutlook?.narrative).toContain("ready to submit");
    expect(p.commitments.some((c) => c.title.startsWith("Advance toward"))).toBe(false);
  });

  it("returns no tier outlook when the snapshot has no tier plan", () => {
    const p = buildQbrPacket(snap({ tier: null }), PRIOR, MOVES, null);
    expect(p.tierOutlook).toBeNull();
    expect(p.headline).not.toContain("→");
  });
});
