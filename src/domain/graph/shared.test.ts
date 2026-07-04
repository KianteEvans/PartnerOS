import { describe, it, expect } from "vitest";
import { SITUATION_LABELS, type Decision, type Situation } from "@/domain/command/brief";
import {
  bandTone,
  driverTone,
  severityTone,
  decisionToActionKey,
  SITUATION_TO_DRIVER,
  DRIVER_WEIGHT_KEY,
} from "@/domain/graph/shared";

function decision(over: Partial<Decision> & Pick<Decision, "id" | "situation">): Decision {
  return {
    severity: "high",
    title: "t",
    detail: "d",
    ownerUserId: null,
    dueDate: null,
    link: "/x",
    ...over,
  };
}

describe("graph shared helpers", () => {
  it("bandTone follows the Command Center band colors", () => {
    expect(bandTone("strong")).toBe("ok");
    expect(bandTone("fair")).toBe("warn");
    expect(bandTone("at_risk")).toBe("danger");
  });

  it("driverTone follows the ≥70 / ≥45 thresholds", () => {
    expect(driverTone(80)).toBe("ok");
    expect(driverTone(70)).toBe("ok");
    expect(driverTone(60)).toBe("warn");
    expect(driverTone(45)).toBe("warn");
    expect(driverTone(30)).toBe("danger");
  });

  it("severityTone maps critical/high/medium", () => {
    expect(severityTone("critical")).toBe("danger");
    expect(severityTone("high")).toBe("warn");
    expect(severityTone("medium")).toBe("neutral");
  });

  it("SITUATION_TO_DRIVER is total over every Situation and marketplace/sync map to null", () => {
    for (const s of Object.keys(SITUATION_LABELS) as Situation[]) {
      expect(s in SITUATION_TO_DRIVER).toBe(true);
    }
    expect(SITUATION_TO_DRIVER.marketplace_entitlement).toBeNull();
    expect(SITUATION_TO_DRIVER.aws_sync_drift).toBeNull();
    expect(SITUATION_TO_DRIVER.overdue_work).toBe("Tasks");
    expect(SITUATION_TO_DRIVER.aws_review).toBe("ACE");
    expect(SITUATION_TO_DRIVER.evidence).toBe("Evidence");
  });

  it("DRIVER_WEIGHT_KEY covers all six drivers", () => {
    expect(Object.keys(DRIVER_WEIGHT_KEY).sort()).toEqual(["ACE", "Evidence", "MDF", "Programs", "Tasks", "Tier"]);
  });

  it("decisionToActionKey recovers the ranker key for actionable decisions", () => {
    expect(decisionToActionKey(decision({ id: "task-overdue-abc", situation: "overdue_work" }))).toBe("task-abc");
    expect(decisionToActionKey(decision({ id: "task-blocked-xyz", situation: "blocked_work" }))).toBe("task-xyz");
    expect(decisionToActionKey(decision({ id: "mdf-m1", situation: "mdf_deadline" }))).toBe("mdf-m1");
    expect(decisionToActionKey(decision({ id: "opp-o1", situation: "aws_review" }))).toBe("opp-o1");
    expect(decisionToActionKey(decision({ id: "milestone-ms1", situation: "roadmap_risk" }))).toBe("milestone-ms1");
    expect(decisionToActionKey(decision({ id: "evidence-e1", situation: "evidence" }))).toBe("evidence-e1");
  });

  it("decisionToActionKey returns null for decisions with no what-if transform", () => {
    expect(decisionToActionKey(decision({ id: "rep-r1", situation: "aws_review" }))).toBeNull();
    expect(decisionToActionKey(decision({ id: "milestone-upcoming-ms2", situation: "roadmap_risk" }))).toBeNull();
    expect(decisionToActionKey(decision({ id: "program-p1", situation: "roadmap_risk" }))).toBeNull();
    expect(decisionToActionKey(decision({ id: "planev-e1", situation: "plan_submission_due" }))).toBeNull();
    expect(decisionToActionKey(decision({ id: "solution-renewal-s1", situation: "renewal_due" }))).toBeNull();
  });
});
