import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  reportPreflight,
  narrativeSummary,
  allowedNext,
  canExport,
  healthFromSnapshot,
  snapshotDelta,
  type SnapshotInputs,
  type ReportSnapshot,
} from "@/domain/reports/metrics";

const TODAY = "2026-06-23";

const EMPTY: SnapshotInputs = {
  mdf: [],
  opportunities: [],
  evidence: [],
  programs: [],
  tier: null,
  tierRequirements: [],
  tasks: [],
  assessments: [],
};

describe("report metrics", () => {
  it("builds a zeroed snapshot from empty inputs", () => {
    const s = buildSnapshot(EMPTY, TODAY);
    expect(s.mdf.requested).toBe(0);
    expect(s.ace.open).toBe(0);
    expect(s.evidence.total).toBe(0);
    expect(s.tier).toBeNull();
    expect(s.assessments.latestScore).toBeNull();
  });

  it("aggregates across sections, reusing the domain summaries", () => {
    const s = buildSnapshot(
      {
        ...EMPTY,
        mdf: [
          {
            status: "approved",
            ownerUserId: "u1",
            requestedAmount: 10_000,
            approvedAmount: 8_000,
            deployedAmount: null,
            claimedAmount: null,
            reimbursedAmount: null,
            expectedPipeline: 40_000,
            startDate: null,
            endDate: null,
            claimDeadline: null,
            opportunityRef: null,
          },
        ],
        opportunities: [
          { status: "open", stage: "qualified", amount: 100_000, source: "amazon_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-06-20", closeDate: "2026-09-01", routingStatus: "routed" },
          { status: "won", stage: "launched", amount: 50_000, source: "marketplace", ownerUserId: "u1", nextStep: "", lastInteraction: null, closeDate: null, routingStatus: "approved" },
        ],
        evidence: [
          { status: "approved", ownerUserId: "u1", expirationDate: null, createdAt: new Date("2026-01-01") },
          { status: "missing", ownerUserId: null, expirationDate: null, createdAt: new Date("2026-01-01") },
        ],
        programs: [{ status: "active" }, { status: "pending" }, { status: "expired" }],
        tier: { currentTier: "select", targetTier: "advanced", status: "active" },
        tierRequirements: [
          { key: "a", label: "A", category: "x", threshold: 10, currentValue: 10 },
          { key: "b", label: "B", category: "x", threshold: 10, currentValue: 4 },
        ],
        tasks: [
          { status: "open", dueDate: "2026-01-01" }, // overdue
          { status: "done", dueDate: null },
        ],
        assessments: [
          { status: "scored", overallScore: 72 },
          { status: "scored", overallScore: 88 },
          { status: "draft", overallScore: null },
        ],
      },
      TODAY,
    );
    expect(s.mdf.approved).toBe(8_000);
    expect(s.mdf.roi).toBe(5); // pipeline 40k / approved 8k
    expect(s.ace.open).toBe(1);
    expect(s.ace.wonValue).toBe(50_000);
    expect(s.evidence.percent).toBe(50);
    expect(s.programs).toEqual({ total: 3, active: 1, pending: 1, expired: 1 });
    expect(s.tier).toEqual({ current: "select", target: "advanced", status: "active", met: 1, total: 2, percent: 50 });
    expect(s.tasks).toEqual({ total: 2, open: 1, done: 1, overdue: 1 });
    expect(s.assessments).toEqual({ count: 3, scored: 2, latestScore: 88 });
  });

  it("preflight is not ready with no data, ready with some", () => {
    expect(reportPreflight(buildSnapshot(EMPTY, TODAY)).ready).toBe(false);
    const withData = buildSnapshot({ ...EMPTY, programs: [{ status: "active" }] }, TODAY);
    expect(reportPreflight(withData).ready).toBe(true);
  });

  it("narrative summary mentions the report type", () => {
    const text = narrativeSummary(buildSnapshot(EMPTY, TODAY), "qbr");
    expect(text).toContain("AWS QBR");
  });

  it("lifecycle transitions are linear", () => {
    expect(allowedNext("draft")).toEqual(["reviewed"]);
    expect(allowedNext("approved")).toEqual(["exported"]);
    expect(allowedNext("exported")).toEqual([]);
    expect(canExport("approved")).toBe(true);
    expect(canExport("draft")).toBe(false);
  });
});

const BASE: ReportSnapshot = {
  mdf: { requested: 0, approved: 0, deployed: 0, claimed: 0, reimbursed: 0, remaining: 0, pipeline: 0, roi: null, deadlineRisks: 0, open: 0 },
  ace: { open: 0, openValue: 0, won: 0, wonValue: 0, atRisk: 0, unrouted: 0 },
  evidence: { total: 0, approved: 0, missing: 0, percent: 0 },
  programs: { total: 0, active: 0, pending: 0, expired: 0 },
  tier: null,
  tasks: { total: 0, open: 0, done: 0, overdue: 0 },
  assessments: { count: 0, scored: 0, latestScore: null },
};

describe("healthFromSnapshot", () => {
  it("averages the present section drivers and bands the score", () => {
    const h = healthFromSnapshot({
      ...BASE,
      evidence: { total: 4, approved: 2, missing: 2, percent: 50 }, // 50
      programs: { total: 4, active: 2, pending: 1, expired: 1 }, // 50
      tier: { current: "select", target: "advanced", status: "active", met: 3, total: 4, percent: 75 }, // 75
      tasks: { total: 4, open: 2, done: 2, overdue: 1 }, // (1 - 1/2)*100 = 50
      ace: { open: 4, openValue: 100, won: 0, wonValue: 0, atRisk: 1, unrouted: 0 }, // (1 - 1/4)*100 = 75
      mdf: { ...BASE.mdf, requested: 100, approved: 80 }, // 80
    });
    expect(h.drivers.map((d) => d.label)).toEqual(["Evidence", "Programs", "Tier", "Tasks", "ACE", "MDF"]);
    expect(h.score).toBe(63); // (50+50+75+50+75+80)/6 = 63.3
    expect(h.band).toBe("fair");
  });

  it("skips absent sections; an empty snapshot is at_risk with no drivers", () => {
    const empty = healthFromSnapshot(BASE);
    expect(empty.drivers).toEqual([]);
    expect(empty).toMatchObject({ score: 0, band: "at_risk" });
    const allDone = healthFromSnapshot({ ...BASE, tasks: { total: 3, open: 0, done: 3, overdue: 0 } });
    expect(allDone.drivers).toEqual([{ label: "Tasks", score: 100 }]);
    expect(allDone.band).toBe("strong");
  });
});

describe("snapshotDelta", () => {
  it("diffs headline KPIs vs a prior snapshot; overdue is invert", () => {
    const cur = { ...BASE, mdf: { ...BASE.mdf, approved: 8000 }, evidence: { total: 4, approved: 3, missing: 1, percent: 75 }, tasks: { total: 5, open: 3, done: 2, overdue: 1 } };
    const prior = { ...BASE, mdf: { ...BASE.mdf, approved: 5000 }, evidence: { total: 4, approved: 2, missing: 2, percent: 50 }, tasks: { total: 5, open: 4, done: 1, overdue: 3 } };
    const by = Object.fromEntries(snapshotDelta(cur, prior).map((d) => [d.label, d]));
    expect(by["MDF approved"]!.delta).toBe(3000);
    expect(by["Evidence %"]!.delta).toBe(25);
    expect(by["Overdue tasks"]).toMatchObject({ current: 1, prior: 3, delta: -2, invert: true });
  });

  it("returns null deltas when there is no prior report", () => {
    const d = snapshotDelta(BASE, null);
    expect(d.every((x) => x.prior === null && x.delta === null)).toBe(true);
    expect(d.find((x) => x.label === "MDF approved")!.current).toBe(0);
  });
});
