import { describe, it, expect } from "vitest";
import { healthScore } from "@/domain/command/health";
import { deriveDecisions, workSummary, filterDecisions } from "@/domain/command/brief";
import { buildCommandCenter } from "@/domain/command/aggregate";
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

describe("command health", () => {
  it("an empty workspace is neutral, not penalized", () => {
    const h = healthScore(EMPTY, TODAY);
    expect(h.score).toBe(70);
    expect(h.band).toBe("fair");
  });

  it("overdue tasks and MDF deadline risk drag the score down", () => {
    const h = healthScore(
      inputs({
        tasks: [
          { id: "1", title: "a", status: "open", priority: "high", ownerUserId: "u1", dueDate: "2026-01-01" },
          { id: "2", title: "b", status: "open", priority: "low", ownerUserId: "u1", dueDate: "2026-12-01" },
        ],
        mdf: [
          { id: "m1", title: "evt", status: "approved", ownerUserId: "u1", requestedAmount: 1000, approvedAmount: 1000, deployedAmount: null, claimedAmount: null, reimbursedAmount: null, expectedPipeline: 0, startDate: null, endDate: null, claimDeadline: "2026-01-01", opportunityRef: null },
        ],
      }),
      TODAY,
    );
    const tasks = h.drivers.find((d) => d.label === "Tasks")!;
    const mdf = h.drivers.find((d) => d.label === "MDF")!;
    expect(tasks.score).toBe(50); // 1 of 2 open overdue
    expect(mdf.score).toBe(75); // one deadline risk -> 100 - 25
    expect(h.score).toBeLessThan(70);
  });
});

describe("command brief", () => {
  const populated = inputs({
    tasks: [
      { id: "t1", title: "Ship deck", status: "open", priority: "critical", ownerUserId: "u1", dueDate: "2026-01-01" }, // overdue critical
      { id: "t2", title: "Blocked thing", status: "blocked", priority: "medium", ownerUserId: "u2", dueDate: null },
      { id: "t3", title: "Done", status: "done", priority: "low", ownerUserId: "u1", dueDate: "2026-01-01" },
    ],
    mdf: [
      { id: "m1", title: "Re:Invent", status: "approved", ownerUserId: "u1", requestedAmount: 1000, approvedAmount: 1000, deployedAmount: null, claimedAmount: null, reimbursedAmount: null, expectedPipeline: 0, startDate: null, endDate: null, claimDeadline: "2026-07-01", opportunityRef: null }, // deadline risk
    ],
    opportunities: [
      { id: "o1", name: "Big deal", status: "open", stage: "qualified", amount: 200_000, source: "amazon_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-01-01", closeDate: "2026-09-01", routingStatus: "routed", accountName: "Acme", awsContactId: null }, // at-risk + high value
    ],
    programs: [
      { id: "p1", name: "Migration", status: "expired", expirationDate: "2026-01-01" },
    ],
  });

  it("derives decisions across sections, most urgent first", () => {
    const d = deriveDecisions(populated, TODAY);
    expect(d[0]!.severity).toBe("critical"); // overdue critical task
    const situations = new Set(d.map((x) => x.situation));
    expect(situations).toContain("overdue_work");
    expect(situations).toContain("blocked_work");
    expect(situations).toContain("mdf_deadline");
    expect(situations).toContain("aws_review");
    expect(situations).toContain("roadmap_risk");
  });

  it("work summary counts open/overdue/blocked/critical", () => {
    expect(workSummary(populated.tasks, TODAY)).toEqual({ open: 2, overdue: 1, blocked: 1, critical: 1 });
  });

  it("filters the decision queue by view", () => {
    const d = deriveDecisions(populated, TODAY);
    expect(filterDecisions(d, "critical").every((x) => x.severity === "critical")).toBe(true);
    expect(filterDecisions(d, "mdf_deadline").every((x) => x.situation === "mdf_deadline")).toBe(true);
  });

  it("flags a cooling AWS relationship with pipeline at risk", () => {
    const d = deriveDecisions(
      inputs({
        relationships: [
          { id: "r1", name: "Jordan AE", role: "seller", accountName: "Globex", strength: 80, lastContact: "2026-01-01" },
        ],
        opportunities: [
          { id: "o9", name: "Globex deal", status: "open", stage: "qualified", amount: 300_000, source: "partner_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-06-20", closeDate: null, routingStatus: "routed", accountName: "Globex", awsContactId: null },
        ],
      }),
      TODAY,
    );
    const rep = d.find((x) => x.id === "rep-r1");
    expect(rep).toBeTruthy();
    expect(rep!.situation).toBe("aws_review");
    expect(rep!.severity).toBe("high");
  });

  it("flags an overdue milestone on a finalized roadmap (not future/done)", () => {
    const d = deriveDecisions(
      inputs({
        milestones: [
          { id: "ms1", roadmapId: "rm1", title: "Earn Security Competency", status: "planned", targetDate: "2026-01-01", ownerUserId: "u1" },
          { id: "ms2", roadmapId: "rm1", title: "Future step", status: "planned", targetDate: "2026-12-01", ownerUserId: "u1" },
          { id: "ms3", roadmapId: "rm1", title: "Already done", status: "done", targetDate: "2026-01-01", ownerUserId: "u1" },
        ],
      }),
      TODAY,
    );
    const od = d.find((x) => x.id === "milestone-ms1");
    expect(od).toBeTruthy();
    expect(od!.situation).toBe("roadmap_risk");
    expect(od!.severity).toBe("high");
    expect(od!.link).toBe("/roadmaps/rm1");
    expect(d.some((x) => x.id === "milestone-ms2")).toBe(false);
    expect(d.some((x) => x.id === "milestone-ms3")).toBe(false);
  });

  it("flags a Specialization Solution whose renewal is slipping; spares the compliant one", () => {
    const d = deriveDecisions(
      inputs({
        solutions: [
          { id: "s1", title: "Threat Detection Platform", availability: "available", programType: "Competency", solutionType: "consulting_service", ftrStatus: "none", launchedCount: 0, renewalDate: null }, // 1 gap (no launched opps)
          { id: "s2", title: "Healthy Solution", availability: "available", programType: "Competency", solutionType: "consulting_service", ftrStatus: "none", launchedCount: 2, renewalDate: null }, // compliant
        ],
        currentTier: "advanced",
      }),
      TODAY,
    );
    const r = d.find((x) => x.id === "solution-renewal-s1");
    expect(r).toBeTruthy();
    expect(r!.situation).toBe("renewal_due");
    expect(r!.severity).toBe("high"); // one gap -> at_risk
    expect(r!.link).toBe("/solutions/s1");
    expect(d.some((x) => x.id === "solution-renewal-s2")).toBe(false); // compliant -> no signal
  });

  it("escalates a non-compliant Solution to a critical renewal signal", () => {
    const d = deriveDecisions(
      inputs({
        solutions: [
          { id: "s3", title: "Inactive + no launches", availability: "unsupported", programType: "Competency", solutionType: "consulting_service", ftrStatus: "none", launchedCount: 0, renewalDate: null }, // 2 gaps
        ],
        currentTier: "advanced",
      }),
      TODAY,
    );
    const r = d.find((x) => x.id === "solution-renewal-s3");
    expect(r!.severity).toBe("critical"); // two gaps -> non_compliant
  });
});

describe("buildCommandCenter", () => {
  it("composes health, work, decisions, and progress", () => {
    const cc = buildCommandCenter(
      inputs({
        tasks: [{ id: "t1", title: "x", status: "open", priority: "critical", ownerUserId: "u1", dueDate: "2026-01-01" }],
        programs: [{ id: "p1", name: "A", status: "active", expirationDate: null }],
      }),
      TODAY,
    );
    expect(cc.topRisk?.severity).toBe("critical");
    expect(cc.requiredDecision?.ownerUserId).toBe("u1");
    expect(cc.progress.programsActive).toBe(1);
    expect(cc.work.overdue).toBe(1);
  });
});
