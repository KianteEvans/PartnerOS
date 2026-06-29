import { describe, it, expect } from "vitest";
import type { MdfLike } from "@/domain/mdf/analytics";
import {
  filterRequests,
  viewCounts,
  sortRequests,
  type MdfView,
} from "@/domain/mdf/views";

const TODAY = "2026-06-23";
const U1 = "user-1";
const U2 = "user-2";

type Row = MdfLike & { title: string; activityType: string; createdAt: Date };

function row(over: Partial<Row>): Row {
  return {
    status: "draft",
    ownerUserId: U1,
    requestedAmount: 10_000,
    approvedAmount: null,
    deployedAmount: null,
    claimedAmount: null,
    reimbursedAmount: null,
    expectedPipeline: 50_000,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    claimDeadline: null,
    opportunityRef: "OPP-1",
    title: "Untitled",
    activityType: "other",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

// r1 draft/U1/event; r2 requested/U2/campaign; r3 deployed/U1/event w/ near deadline
// (to_claim + at_risk); r4 reimbursed/U1/content; r5 approved/U2/event, far deadline.
const r1 = row({ status: "draft", ownerUserId: U1, title: "Alpha", activityType: "event", requestedAmount: 10_000 });
const r2 = row({ status: "requested", ownerUserId: U2, title: "Bravo", activityType: "campaign", requestedAmount: 20_000 });
const r3 = row({ status: "deployed", ownerUserId: U1, title: "Charlie", activityType: "event", requestedAmount: 30_000, approvedAmount: 30_000, claimDeadline: "2026-07-01" });
const r4 = row({ status: "reimbursed", ownerUserId: U1, title: "Delta", activityType: "content", requestedAmount: 15_000, approvedAmount: 15_000 });
const r5 = row({ status: "approved", ownerUserId: U2, title: "Echo", activityType: "event", requestedAmount: 25_000, approvedAmount: 25_000, claimDeadline: "2026-12-01" });

const ALL = [r1, r2, r3, r4, r5];
const ctx = { userId: U1, today: TODAY };

const f = (view: MdfView, activity = "all", q = "") =>
  filterRequests(ALL, { view, activity, q }, ctx);

describe("mdf views", () => {
  it("partitions each view correctly", () => {
    expect(f("all")).toEqual(ALL);
    expect(f("mine")).toEqual([r1, r3, r4]);
    expect(f("awaiting_approval")).toEqual([r2]);
    expect(f("to_claim")).toEqual([r3]); // deployed, not yet claimed
    expect(f("at_risk")).toEqual([r3]); // deployed + deadline within 30d
    expect(f("reimbursed")).toEqual([r4]);
    expect(f("drafts")).toEqual([r1]);
  });

  it("layers an activity-type filter and a title search on top of the view", () => {
    expect(f("all", "event")).toEqual([r1, r3, r5]);
    expect(f("all", "all", "alp")).toEqual([r1]);
    expect(f("mine", "event")).toEqual([r1, r3]);
  });

  it("viewCounts reports per-view totals over all rows", () => {
    expect(viewCounts(ALL, ctx)).toEqual({
      all: 5,
      mine: 3,
      awaiting_approval: 1,
      to_claim: 1,
      at_risk: 1,
      reimbursed: 1,
      drafts: 1,
    });
  });

  it("sortRequests orders by the chosen column and direction", () => {
    expect(sortRequests(ALL, "requested", "desc").map((r) => r.title)).toEqual([
      "Charlie", "Echo", "Bravo", "Delta", "Alpha",
    ]);
    expect(sortRequests(ALL, "title", "asc").map((r) => r.title)).toEqual([
      "Alpha", "Bravo", "Charlie", "Delta", "Echo",
    ]);
  });
});
