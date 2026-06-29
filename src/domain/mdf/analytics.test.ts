import { describe, it, expect } from "vitest";
import { allowedNext, canTransition, isOpen, lifecycleSteps } from "@/domain/mdf/lifecycle";
import { daysBetween } from "@/domain/dates";
import {
  preflight,
  roiMultiple,
  committedAmount,
  deadlineRisk,
  portfolioSummary,
  reimbursementRate,
  claimedShare,
  summaryByActivity,
  type MdfLike,
} from "@/domain/mdf/analytics";

const TODAY = "2026-06-23";

function req(over: Partial<MdfLike>): MdfLike {
  return {
    status: "draft",
    ownerUserId: "u1",
    requestedAmount: 10_000,
    approvedAmount: null,
    deployedAmount: null,
    claimedAmount: null,
    reimbursedAmount: null,
    expectedPipeline: 50_000,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    claimDeadline: "2026-09-01",
    opportunityRef: "OPP-123",
    ...over,
  };
}

describe("mdf lifecycle", () => {
  it("only permits the defined transitions", () => {
    expect(allowedNext("draft")).toEqual(["requested"]);
    expect(allowedNext("requested")).toEqual(["approved", "rejected"]);
    expect(allowedNext("reimbursed")).toEqual([]);
    expect(canTransition("approved", "deployed")).toBe(true);
    expect(canTransition("approved", "claimed")).toBe(false);
  });

  it("isOpen excludes terminal states", () => {
    expect(isOpen("deployed")).toBe(true);
    expect(isOpen("rejected")).toBe(false);
    expect(isOpen("reimbursed")).toBe(false);
  });
});

describe("mdf eligibility preflight", () => {
  it("passes a complete request", () => {
    expect(preflight(req({})).eligible).toBe(true);
  });

  it("fails when required fields are missing or over cap", () => {
    expect(preflight(req({ ownerUserId: null })).eligible).toBe(false);
    expect(preflight(req({ opportunityRef: null })).eligible).toBe(false);
    expect(preflight(req({ expectedPipeline: 0 })).eligible).toBe(false);
    expect(preflight(req({ requestedAmount: 60_000 })).eligible).toBe(false); // over cap
    expect(preflight(req({ startDate: "2026-08-01", endDate: "2026-07-01" })).eligible).toBe(false);
  });
});

describe("mdf finance", () => {
  it("committedAmount picks the most-advanced stage amount", () => {
    expect(committedAmount(req({ approvedAmount: 8000 }))).toBe(8000);
    expect(committedAmount(req({ approvedAmount: 8000, deployedAmount: 7000 }))).toBe(7000);
    expect(committedAmount(req({ approvedAmount: 8000, claimedAmount: 6000 }))).toBe(6000);
  });

  it("roiMultiple is pipeline over committed spend", () => {
    expect(roiMultiple(req({ approvedAmount: 10_000, expectedPipeline: 50_000 }))).toBe(5);
    expect(roiMultiple(req({ requestedAmount: 0, approvedAmount: null }))).toBeNull();
  });

  it("deadlineRisk flags soon/overdue claim deadlines on un-claimed funds", () => {
    expect(deadlineRisk(req({ status: "approved", claimDeadline: "2026-07-01" }), TODAY)).toBe(true); // within 30d
    expect(deadlineRisk(req({ status: "approved", claimDeadline: "2026-12-01" }), TODAY)).toBe(false);
    expect(deadlineRisk(req({ status: "claimed", claimDeadline: "2026-07-01" }), TODAY)).toBe(false); // already claimed
    expect(deadlineRisk(req({ status: "deployed", claimDeadline: "2026-01-01" }), TODAY)).toBe(true); // overdue
  });

  it("portfolioSummary reconciles across stages", () => {
    const reqs = [
      req({ status: "approved", approvedAmount: 10_000, expectedPipeline: 40_000, claimDeadline: "2026-07-01" }),
      req({ status: "claimed", approvedAmount: 5_000, deployedAmount: 5_000, claimedAmount: 5_000, expectedPipeline: 20_000 }),
      req({ status: "rejected", expectedPipeline: 0 }),
    ];
    const s = portfolioSummary(reqs, TODAY);
    expect(s.requested).toBe(30_000); // 3 requests, each default 10k
    expect(s.approved).toBe(15_000);
    expect(s.claimed).toBe(5_000);
    expect(s.remaining).toBe(10_000); // approved 15k - claimed 5k
    expect(s.roi).toBe(4); // pipeline 60k / approved 15k
    expect(s.deadlineRisks).toBe(1);
    expect(s.openCount).toBe(2); // approved + claimed (rejected is closed)
  });

  it("reimbursementRate is reimbursed over approved (clamped); 0 when nothing approved", () => {
    const s = portfolioSummary(
      [req({ status: "reimbursed", approvedAmount: 10_000, deployedAmount: 10_000, claimedAmount: 10_000, reimbursedAmount: 6_000 })],
      TODAY,
    );
    expect(reimbursementRate(s)).toBe(60);
    expect(reimbursementRate(portfolioSummary([], TODAY))).toBe(0);
  });

  it("claimedShare is a request's claimed over approved", () => {
    expect(claimedShare(req({ approvedAmount: 8_000, claimedAmount: 4_000 }))).toBe(50);
    expect(claimedShare(req({ approvedAmount: null }))).toBe(0);
  });
});

describe("daysBetween", () => {
  it("counts whole signed days", () => {
    expect(daysBetween("2026-06-01", "2026-06-08")).toBe(7);
    expect(daysBetween("2026-06-08", "2026-06-01")).toBe(-7);
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(0);
  });
});

describe("lifecycleSteps", () => {
  it("tags the current stage and marks prior stages done", () => {
    const steps = lifecycleSteps("deployed");
    expect(steps.map((s) => s.key)).toEqual([
      "draft", "requested", "approved", "deployed", "claimed", "reimbursed",
    ]);
    expect(steps.find((s) => s.key === "approved")?.state).toBe("done");
    expect(steps.find((s) => s.key === "deployed")?.state).toBe("current");
    expect(steps.find((s) => s.key === "claimed")?.state).toBe("upcoming");
  });

  it("short-circuits a rejected request to a distinct terminal chip", () => {
    const steps = lifecycleSteps("rejected");
    expect(steps.map((s) => s.key)).toEqual(["draft", "requested", "rejected"]);
    expect(steps.at(-1)?.state).toBe("rejected");
  });

  it("a reimbursed request is fully done", () => {
    expect(lifecycleSteps("reimbursed").every((s) => s.state === "done" || s.state === "current")).toBe(true);
    expect(lifecycleSteps("reimbursed").at(-1)?.state).toBe("current");
  });
});

describe("summaryByActivity", () => {
  it("rolls spend up by activity type, sorted by approved, with per-type ROI", () => {
    const rows: (MdfLike & { activityType: string })[] = [
      { ...req({ approvedAmount: 10_000, reimbursedAmount: 4_000, expectedPipeline: 50_000 }), activityType: "event" },
      { ...req({ approvedAmount: 5_000, expectedPipeline: 10_000 }), activityType: "event" },
      { ...req({ approvedAmount: 20_000, expectedPipeline: 40_000 }), activityType: "campaign" },
    ];
    const out = summaryByActivity(rows);
    expect(out.map((a) => a.activityType)).toEqual(["campaign", "event"]); // campaign approved 20k > event 15k
    const event = out.find((a) => a.activityType === "event")!;
    expect(event.count).toBe(2);
    expect(event.approved).toBe(15_000);
    expect(event.reimbursed).toBe(4_000);
    expect(event.pipeline).toBe(60_000);
    expect(event.roi).toBe(4); // 60k / 15k
    expect(summaryByActivity([])).toEqual([]);
  });
});
