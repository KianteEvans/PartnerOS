import { describe, it, expect } from "vitest";
import {
  buildSnapshot,
  reportPreflight,
  narrativeSummary,
  allowedNext,
  canExport,
  type SnapshotInputs,
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
