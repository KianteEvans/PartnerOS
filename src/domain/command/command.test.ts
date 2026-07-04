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

  it("flags a planned event with a near fund-request submit-by, skipping converted/far ones", () => {
    const d = deriveDecisions(
      inputs({
        planEvents: [
          { id: "pe1", planId: "pl1", title: "Conference", submitBy: "2026-06-25", converted: false, ownerUserId: "u1" }, // within 14d
          { id: "pe2", planId: "pl1", title: "Webinar", submitBy: "2026-06-25", converted: true, ownerUserId: "u1" }, // converted -> skip
          { id: "pe3", planId: "pl1", title: "Far event", submitBy: "2026-09-01", converted: false, ownerUserId: "u1" }, // outside window
        ],
      }),
      TODAY,
    );
    const plan = d.filter((x) => x.situation === "plan_submission_due");
    expect(plan).toHaveLength(1);
    expect(plan[0]!.link).toBe("/mdf/plan/pl1");
    expect(plan[0]!.title).toContain("Conference");
  });

  it("flags marketplace signals: entitlement lapse, failed change set, and published revenue gaps", () => {
    const d = deriveDecisions(
      inputs({
        marketplace: [
          { id: "L1", title: "Acme Analytics", published: true, expiringEntitlements: 2, expiredEntitlements: 0, failedChangeSets: 0, acceptedUsageCount: 5, attributedRevenueCents: 1000 },
          { id: "L2", title: "Beta Platform", published: true, expiringEntitlements: 0, expiredEntitlements: 0, failedChangeSets: 1, acceptedUsageCount: 0, attributedRevenueCents: 0 },
          { id: "L3", title: "Draft Tool", published: false, expiringEntitlements: 0, expiredEntitlements: 0, failedChangeSets: 0, acceptedUsageCount: 0, attributedRevenueCents: 0 },
        ],
      }),
      TODAY,
    );
    expect(d.find((x) => x.id === "mp-ent-expiring-L1")?.situation).toBe("marketplace_entitlement");
    expect(d.some((x) => x.id === "mp-cs-L2" && x.situation === "marketplace_changeset")).toBe(true);
    expect(d.some((x) => x.id === "mp-meter-L2" && x.situation === "marketplace_revenue_gap")).toBe(true);
    expect(d.some((x) => x.id === "mp-attr-L2" && x.situation === "marketplace_revenue_gap")).toBe(true);
    // Unpublished listing produces no metering/attribution gap signals.
    expect(d.some((x) => x.id.endsWith("-L3"))).toBe(false);
  });

  it("flags AWS sync signals: stale connection + opportunity drift, quiet when fresh", () => {
    const d = deriveDecisions(
      inputs({ awsSync: { status: "configured", lastSyncDate: null, driftCount: 2 } }),
      TODAY,
    );
    expect(d.some((x) => x.id === "aws-sync-stale" && x.situation === "aws_sync_stale")).toBe(true);
    expect(d.find((x) => x.id === "aws-sync-drift")?.situation).toBe("aws_sync_drift");
    // A fresh, drift-free connection stays quiet.
    const quiet = deriveDecisions(
      inputs({ awsSync: { status: "configured", lastSyncDate: TODAY, driftCount: 0 } }),
      TODAY,
    );
    expect(quiet.some((x) => x.id.startsWith("aws-sync"))).toBe(false);
  });

  it("derives decisions across sections, most urgent first", () => {
    const d = deriveDecisions(populated, TODAY);
    expect(d[0]!.severity).toBe("critical"); // overdue critical task
    const situations = new Set(d.map((x) => x.situation));
    expect(situations).toContain("overdue_work");
    expect(situations).toContain("blocked_work");
    expect(situations).toContain("mdf_deadline");
    expect(situations).toContain("stalled_deal"); // the high-value opp is cold -> stalled, not aws_review
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
    expect(od!.link).toBe("/plan/roadmaps/rm1#ms-ms1");
    expect(d.some((x) => x.id === "milestone-ms2")).toBe(false);
    expect(d.some((x) => x.id === "milestone-ms3")).toBe(false);
  });

  it("warns on a milestone due soon (within the look-ahead window) before it slips", () => {
    const d = deriveDecisions(
      inputs({
        milestones: [
          { id: "up1", roadmapId: "rm2", title: "Submit application", status: "in_progress", targetDate: "2026-06-27", ownerUserId: "u1" }, // due in 4d -> upcoming
          { id: "od1", roadmapId: "rm2", title: "Past due", status: "planned", targetDate: "2026-01-01", ownerUserId: "u1" }, // overdue
          { id: "far1", roadmapId: "rm2", title: "Way out", status: "planned", targetDate: "2026-12-01", ownerUserId: "u1" }, // beyond window
          { id: "done1", roadmapId: "rm2", title: "Finished early", status: "done", targetDate: "2026-06-27", ownerUserId: "u1" }, // done -> nothing
        ],
      }),
      TODAY,
    );
    const up = d.find((x) => x.id === "milestone-upcoming-up1");
    expect(up).toBeTruthy();
    expect(up!.severity).toBe("medium");
    expect(up!.situation).toBe("roadmap_risk");
    expect(up!.link).toBe("/plan/roadmaps/rm2#ms-up1");
    // Overdue stays high, and the two states are mutually exclusive.
    expect(d.find((x) => x.id === "milestone-od1")!.severity).toBe("high");
    expect(d.some((x) => x.id === "milestone-upcoming-od1")).toBe(false);
    // Beyond-window and done milestones produce nothing.
    expect(d.some((x) => x.id.includes("far1"))).toBe(false);
    expect(d.some((x) => x.id.includes("done1"))).toBe(false);
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
    expect(r!.link).toBe("/programs/solutions/s1");
    expect(d.some((x) => x.id === "solution-renewal-s2")).toBe(false); // compliant -> no signal
  });

  it("flags open funding submissions whose deadline is near or past; ignores far/closed/undated", () => {
    const d = deriveDecisions(
      inputs({
        fundingSubmissions: [
          { id: "f1", title: "MAP funding", open: true, deadline: "2026-07-10", ownerUserId: "u1" }, // within 30d -> high
          { id: "f2", title: "POC credits", open: true, deadline: "2026-06-01", ownerUserId: "u2" }, // past -> critical
          { id: "f3", title: "Far off", open: true, deadline: "2026-09-01", ownerUserId: "u1" }, // beyond window
          { id: "f4", title: "Already funded", open: false, deadline: "2026-07-01", ownerUserId: "u1" }, // closed
          { id: "f5", title: "No deadline", open: true, deadline: null, ownerUserId: "u1" }, // undated
        ],
      }),
      TODAY,
    );
    const near = d.find((x) => x.id === "funding-f1");
    expect(near).toBeTruthy();
    expect(near!.situation).toBe("funding_deadline");
    expect(near!.severity).toBe("high");
    expect(near!.link).toBe("/funding/submissions/f1");
    expect(d.find((x) => x.id === "funding-f2")!.severity).toBe("critical"); // overdue
    expect(d.some((x) => x.id === "funding-f3")).toBe(false); // beyond window
    expect(d.some((x) => x.id === "funding-f4")).toBe(false); // closed (not open)
    expect(d.some((x) => x.id === "funding-f5")).toBe(false); // undated
  });

  it("splits at-risk opportunities: cold -> stalled_deal, past-close -> aws_review, low-value -> neither", () => {
    const d = deriveDecisions(
      inputs({
        opportunities: [
          // High-value + cold (no activity in months) -> stalled_deal, on the opp-{id} id.
          { id: "cold", name: "Cold whale", status: "open", stage: "qualified", amount: 250_000, source: "partner_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-01-01", closeDate: "2026-12-01", routingStatus: "routed", accountName: "A", awsContactId: null },
          // High-value + fresh but past its close date -> aws_review (needs a co-sell review).
          { id: "late", name: "Late close", status: "open", stage: "committed", amount: 300_000, source: "partner_originated", ownerUserId: "u2", nextStep: "x", lastInteraction: "2026-06-20", closeDate: "2026-05-01", routingStatus: "routed", accountName: "B", awsContactId: null },
          // Stale but LOW value -> neither (both signals are high-value only).
          { id: "small", name: "Small + cold", status: "open", stage: "qualified", amount: 20_000, source: "partner_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-01-01", closeDate: "2026-12-01", routingStatus: "routed", accountName: "C", awsContactId: null },
        ],
      }),
      TODAY,
    );
    const cold = d.find((x) => x.id === "opp-cold");
    expect(cold!.situation).toBe("stalled_deal");
    expect(cold!.severity).toBe("high");
    expect(cold!.link).toBe("/ace/cold");
    expect(d.find((x) => x.id === "opp-late")!.situation).toBe("aws_review");
    expect(d.some((x) => x.id === "opp-small")).toBe(false);
  });

  it("flags approved evidence that has already lapsed as critical evidence_expired; not expiring or unapproved", () => {
    const d = deriveDecisions(
      inputs({
        evidence: [
          { id: "e1", title: "SOC 2", status: "approved", ownerUserId: "u1", expirationDate: "2026-05-01", createdAt: new Date("2025-01-01") }, // approved + expired
          { id: "e2", title: "ISO soon", status: "approved", ownerUserId: "u1", expirationDate: "2026-07-10", createdAt: new Date("2025-01-01") }, // expiring soon (within 60d) -> still "evidence"
          { id: "e3", title: "Draft lapsed", status: "in_review", ownerUserId: "u1", expirationDate: "2026-05-01", createdAt: new Date("2025-01-01") }, // expired but NOT approved
        ],
      }),
      TODAY,
    );
    const gone = d.find((x) => x.id === "evidence-expired-e1");
    expect(gone!.situation).toBe("evidence_expired");
    expect(gone!.severity).toBe("critical");
    expect(gone!.link).toBe("/programs/evidence");
    expect(d.find((x) => x.id === "evidence-e2")!.situation).toBe("evidence"); // expiring soon takes precedence
    // Unapproved lapsed evidence is not a coverage-loss signal (and isn't "expiring").
    expect(d.some((x) => x.id.includes("e3"))).toBe(false);
  });

  it("surfaces funding re-match candidates as medium funding_rematch decisions linking to the Deal Desk", () => {
    const d = deriveDecisions(
      inputs({
        fundingRematch: [
          { oppId: "o5", oppName: "Globex", amount: 250_000, ownerUserId: "u1", programs: [{ key: "poc_funding", name: "PoC Funding" }] },
        ],
      }),
      TODAY,
    );
    const r = d.find((x) => x.id === "rematch-o5");
    expect(r!.situation).toBe("funding_rematch");
    expect(r!.severity).toBe("medium");
    expect(r!.link).toBe("/ace/o5");
    expect(r!.detail).toContain("PoC Funding");
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

  it("hides snoozed decisions when dismissedIds is passed; topRisk agrees", () => {
    const base = inputs({
      tasks: [{ id: "t1", title: "x", status: "open", priority: "critical", ownerUserId: "u1", dueDate: "2026-01-01" }],
    });
    const raw = buildCommandCenter(base, TODAY);
    expect(raw.decisions.length).toBeGreaterThan(0);
    const snoozedId = raw.decisions[0]!.id;

    const filtered = buildCommandCenter(base, TODAY, new Set([snoozedId]));
    expect(filtered.decisions.some((d) => d.id === snoozedId)).toBe(false);
    expect(filtered.decisions.length).toBe(raw.decisions.length - 1);
    expect(filtered.topRisk?.id).not.toBe(snoozedId);

    // Empty set and omitted param are both the raw queue.
    expect(buildCommandCenter(base, TODAY, new Set()).decisions.length).toBe(raw.decisions.length);
  });

  it("surfaces impact-ranked next-best-actions, each linked and positive-leverage", () => {
    const cc = buildCommandCenter(
      inputs({
        tasks: [{ id: "t1", title: "x", status: "open", priority: "critical", ownerUserId: "u1", dueDate: "2026-01-01" }],
        tier: { currentTier: "select", targetTier: "advanced", status: "active" },
        tierRequirements: [{ key: "b", label: "Launched opportunities", category: "opportunities", threshold: 3, currentValue: 1 }],
      }),
      TODAY,
    );
    expect(cc.nextBestActions.length).toBeGreaterThan(0);
    expect(cc.nextBestActions.every((a) => a.link.length > 0 && a.leverage > 0)).toBe(true);
    for (let i = 1; i < cc.nextBestActions.length; i++) {
      expect(cc.nextBestActions[i - 1]!.leverage).toBeGreaterThanOrEqual(cc.nextBestActions[i]!.leverage);
    }
  });
});
