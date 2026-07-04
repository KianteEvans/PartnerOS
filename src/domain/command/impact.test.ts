import { describe, it, expect } from "vitest";
import {
  baselineFor,
  projectImpact,
  resolveTask,
  winOpp,
  approveEvidence,
  completeMilestone,
  clearMdfDeadline,
  meetRequirement,
  freshenAwsSync,
} from "@/domain/command/impact";
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
const inputs = (over: Partial<CommandInputs>): CommandInputs => ({ ...EMPTY, ...over });

const overdueTask = {
  id: "t1",
  title: "Ship deck",
  status: "open" as const,
  priority: "high" as const,
  ownerUserId: "u1",
  dueDate: "2026-01-01",
};
const advTier = { currentTier: "select", targetTier: "advanced", status: "active" } as const;

describe("what-if transforms are immutable + flip the right field", () => {
  it("resolveTask marks the task done without mutating the input", () => {
    const base = inputs({ tasks: [overdueTask] });
    const next = resolveTask(base, "t1");
    expect(next.tasks[0]!.status).toBe("done");
    expect(base.tasks[0]!.status).toBe("open");
    expect(next).not.toBe(base);
  });

  it("winOpp sets status won, leaving the input untouched", () => {
    const base = inputs({
      opportunities: [
        { id: "o1", name: "Big", accountName: "Acme", awsContactId: null, status: "open", stage: "qualified", amount: 200_000, source: "amazon_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-01-01", closeDate: "2026-01-01", routingStatus: "routed" },
      ],
    });
    const next = winOpp(base, "o1");
    expect(next.opportunities[0]!.status).toBe("won");
    expect(base.opportunities[0]!.status).toBe("open");
  });

  it("meetRequirement raises the current value to the threshold", () => {
    const base = inputs({ tier: advTier, tierRequirements: [{ key: "b", label: "B", category: "c", threshold: 3, currentValue: 1 }] });
    const next = meetRequirement(base, "b");
    expect(next.tierRequirements[0]!.currentValue).toBe(3);
    expect(base.tierRequirements[0]!.currentValue).toBe(1);
  });
});

describe("projectImpact signs (each transform removes its own decision)", () => {
  it("resolving the only overdue task raises health and shrinks the queue", () => {
    const base = inputs({ tasks: [overdueTask] });
    const d = projectImpact(baselineFor(base, TODAY), resolveTask(base, "t1"), TODAY);
    expect(d.healthDelta).toBeGreaterThan(0);
    expect(d.queueDelta).toBe(1);
    expect(d.tierPctDelta).toBe(0);
  });

  it("meeting an unmet gating tier requirement raises tier % + health", () => {
    const base = inputs({
      tier: advTier,
      tierRequirements: [
        { key: "a", label: "A", category: "c", threshold: 2, currentValue: 2 },
        { key: "b", label: "B", category: "c", threshold: 3, currentValue: 1 },
      ],
    });
    const d = projectImpact(baselineFor(base, TODAY), meetRequirement(base, "b"), TODAY);
    expect(d.tierPctDelta).toBe(50); // 1/2 met -> 2/2 met
    expect(d.healthDelta).toBeGreaterThan(0);
  });

  it("approveEvidence clears an expiring-evidence decision", () => {
    const base = inputs({
      evidence: [{ id: "e1", title: "Cert", status: "collected", ownerUserId: "u1", expirationDate: "2026-07-01", createdAt: new Date("2026-01-01") }],
    });
    const d = projectImpact(baselineFor(base, TODAY), approveEvidence(base, "e1"), TODAY);
    expect(d.queueDelta).toBe(1);
    expect(d.healthDelta).toBeGreaterThan(0); // evidence completeness up
  });

  it("completeMilestone clears an overdue-milestone decision", () => {
    const base = inputs({
      milestones: [{ id: "ms1", roadmapId: "rm1", title: "Earn X", status: "planned", targetDate: "2026-01-01", ownerUserId: "u1" }],
    });
    const d = projectImpact(baselineFor(base, TODAY), completeMilestone(base, "ms1"), TODAY);
    expect(d.queueDelta).toBe(1);
  });

  it("clearMdfDeadline clears an MDF deadline decision + lifts the MDF driver", () => {
    const base = inputs({
      mdf: [{ id: "m1", title: "Event", status: "approved", ownerUserId: "u1", requestedAmount: 1000, approvedAmount: 1000, deployedAmount: null, claimedAmount: null, reimbursedAmount: null, expectedPipeline: 0, startDate: null, endDate: null, claimDeadline: "2026-07-01", opportunityRef: null }],
    });
    const d = projectImpact(baselineFor(base, TODAY), clearMdfDeadline(base, "m1"), TODAY);
    expect(d.queueDelta).toBe(1);
    expect(d.healthDelta).toBeGreaterThan(0);
  });

  it("freshenAwsSync clears a drift signal", () => {
    const base = inputs({ awsSync: { status: "configured", lastSyncDate: TODAY, driftCount: 2 } });
    const d = projectImpact(baselineFor(base, TODAY), freshenAwsSync(base, TODAY), TODAY);
    expect(d.queueDelta).toBe(1);
  });
});
