import { describe, it, expect } from "vitest";
import { portfolioSummary, deadlineRisk, type SubmissionLike } from "@/domain/funding/analytics";

const TODAY = "2026-06-23";

function sub(over: Partial<SubmissionLike> = {}): SubmissionLike {
  return { status: "submitted", fundingType: "cash", requestedAmount: 0, approvedAmount: null, deadline: null, ...over };
}

describe("funding analytics", () => {
  it("deadlineRisk fires for an open submission within 30 days or overdue", () => {
    expect(deadlineRisk(sub({ status: "submitted", deadline: "2026-07-01" }), TODAY)).toBe(true); // 8 days out
    expect(deadlineRisk(sub({ status: "in_review", deadline: "2026-01-01" }), TODAY)).toBe(true); // overdue
    expect(deadlineRisk(sub({ status: "submitted", deadline: "2026-12-01" }), TODAY)).toBe(false); // far
    expect(deadlineRisk(sub({ status: "funded", deadline: "2026-06-25" }), TODAY)).toBe(false); // terminal
    expect(deadlineRisk(sub({ deadline: null }), TODAY)).toBe(false);
  });

  it("summarizes a portfolio", () => {
    const rows: SubmissionLike[] = [
      sub({ status: "submitted", fundingType: "cash", requestedAmount: 100_000, deadline: "2026-07-01" }),
      sub({ status: "approved", fundingType: "credits", requestedAmount: 50_000, approvedAmount: 40_000 }),
      sub({ status: "funded", fundingType: "credits", requestedAmount: 20_000, approvedAmount: 20_000 }),
      sub({ status: "rejected", fundingType: "cash", requestedAmount: 30_000 }),
    ];
    const s = portfolioSummary(rows, TODAY);
    expect(s.total).toBe(4);
    expect(s.open).toBe(2); // submitted + approved
    expect(s.approved).toBe(2); // approved + funded
    expect(s.funded).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.requested).toBe(200_000);
    expect(s.approvedAmount).toBe(60_000);
    expect(s.cashCount).toBe(2);
    expect(s.creditsCount).toBe(2);
    expect(s.atDeadline).toBe(1);
  });
});
