import { describe, it, expect } from "vitest";
import { whatBreaksNext, HORIZONS } from "@/domain/command/horizon";
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

describe("whatBreaksNext", () => {
  it("attributes an emerging risk to the FIRST horizon it fires at, exactly once", () => {
    // Task due in 45 days: fine today and at +30, overdue at +60 (and +90).
    const v = whatBreaksNext(
      inputs({
        tasks: [{ id: "t1", title: "Renew cert", status: "open", priority: "high", ownerUserId: "u1", dueDate: "2026-08-07" }],
      }),
      TODAY,
    );
    expect(v.horizons.map((h) => h.days)).toEqual([...HORIZONS]);
    expect(v.horizons[0]!.emerging).toHaveLength(0); // +30: not yet
    expect(v.horizons[1]!.emerging.map((d) => d.id)).toEqual(["task-overdue-t1"]); // +60: fires
    expect(v.horizons[2]!.emerging).toHaveLength(0); // +90: already attributed
  });

  it("an MDF claim deadline inside 30 days emerges at the first horizon", () => {
    const v = whatBreaksNext(
      inputs({
        mdf: [
          // Deadline in 45d: NOT at risk today (outside the 30d window), at risk by +30.
          { id: "m1", title: "Booth", status: "approved", ownerUserId: "u1", requestedAmount: 1000, approvedAmount: 1000, deployedAmount: null, claimedAmount: null, reimbursedAmount: null, expectedPipeline: 0, startDate: null, endDate: null, claimDeadline: "2026-08-07", opportunityRef: null },
        ],
      }),
      TODAY,
    );
    expect(v.horizons[0]!.emerging.map((d) => d.id)).toEqual(["mdf-m1"]);
  });

  it("a currently-fresh high-value deal goes stale by a future horizon", () => {
    const v = whatBreaksNext(
      inputs({
        opportunities: [
          { id: "o1", name: "Big deal", status: "open", stage: "qualified", amount: 300_000, source: "partner_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-06-20", closeDate: null, routingStatus: "routed", accountName: "A", awsContactId: null },
        ],
      }),
      TODAY,
    );
    // Fresh today (3d old); by +30 the last interaction is 33d old -> stalled_deal.
    expect(v.horizons[0]!.emerging.map((d) => d.situation)).toContain("stalled_deal");
  });

  it("projects health decay as overdue ratios grow", () => {
    const v = whatBreaksNext(
      inputs({
        tasks: [
          { id: "t1", title: "a", status: "open", priority: "high", ownerUserId: "u1", dueDate: "2026-07-15" }, // overdue by +30
          { id: "t2", title: "b", status: "open", priority: "low", ownerUserId: "u1", dueDate: "2026-12-01" }, // never in horizon
        ],
      }),
      TODAY,
    );
    expect(v.horizons[0]!.healthDelta).toBeLessThan(0);
    expect(v.horizons[0]!.health).toBe(v.baselineHealth + v.horizons[0]!.healthDelta);
  });

  it("nothing dated means quiet horizons with zero delta", () => {
    const v = whatBreaksNext(EMPTY, TODAY);
    for (const h of v.horizons) {
      expect(h.emerging).toHaveLength(0);
      expect(h.emergingTotal).toBe(0);
      expect(h.healthDelta).toBe(0);
    }
  });
});
