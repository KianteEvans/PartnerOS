import { describe, it, expect } from "vitest";
import { evaluatePlaybooks, type PlaybookLike } from "./evaluate";
import type { Decision, Severity, Situation } from "@/domain/command/brief";

function decision(over: Partial<Decision> & { id: string; situation: Situation; severity: Severity }): Decision {
  return {
    title: "t",
    detail: "d",
    ownerUserId: null,
    dueDate: null,
    link: "/x",
    ...over,
  };
}

const DECISIONS: Decision[] = [
  decision({ id: "task-overdue-1", situation: "overdue_work", severity: "critical" }),
  decision({ id: "task-overdue-2", situation: "overdue_work", severity: "medium" }),
  decision({ id: "funding-9", situation: "funding_deadline", severity: "high" }),
  decision({ id: "opp-3", situation: "aws_review", severity: "high" }),
];

function pb(over: Partial<PlaybookLike> & { id: string }): PlaybookLike {
  return {
    enabled: true,
    triggerSituation: "overdue_work",
    triggerMinSeverity: "medium",
    actionType: "create_task",
    actionParams: {},
    channels: ["in_app"],
    ...over,
  };
}

describe("evaluatePlaybooks", () => {
  it("matches by situation and fires one run per matching decision", () => {
    const runs = evaluatePlaybooks([pb({ id: "p1" })], DECISIONS, "autonomous");
    expect(runs.map((r) => r.decisionId).sort()).toEqual(["task-overdue-1", "task-overdue-2"]);
  });

  it("respects the minimum-severity floor", () => {
    const runs = evaluatePlaybooks([pb({ id: "p1", triggerMinSeverity: "high" })], DECISIONS, "autonomous");
    expect(runs.map((r) => r.decisionId)).toEqual(["task-overdue-1"]); // medium one filtered out
  });

  it("skips disabled playbooks and emits nothing when the mode is off (blocked)", () => {
    expect(evaluatePlaybooks([pb({ id: "p1", enabled: false })], DECISIONS, "autonomous")).toHaveLength(0);
    expect(evaluatePlaybooks([pb({ id: "p1" })], DECISIONS, "off")).toHaveLength(0);
  });

  it("computes the verdict from mode x action risk (the governance truth-table)", () => {
    // create_task = medium risk.
    const medium = (mode: Parameters<typeof evaluatePlaybooks>[2]) =>
      evaluatePlaybooks([pb({ id: "p" })], [DECISIONS[0]!], mode)[0]?.verdict;
    expect(medium("recommend_only")).toBe("recommend");
    expect(medium("auto_with_approval")).toBe("approval"); // medium needs approval
    expect(medium("autonomous")).toBe("auto");

    // notify in-app = low risk -> auto under auto_with_approval.
    const lowNotify = evaluatePlaybooks(
      [pb({ id: "n", actionType: "notify", channels: ["in_app"] })],
      [DECISIONS[0]!],
      "auto_with_approval",
    );
    expect(lowNotify[0]?.verdict).toBe("auto");

    // approve_within_cap = high risk -> approval even in autonomous (governance floor).
    const highApprove = evaluatePlaybooks(
      [pb({ id: "a", triggerSituation: "funding_deadline", actionType: "approve_within_cap" })],
      DECISIONS,
      "autonomous",
    );
    expect(highApprove[0]?.verdict).toBe("approval");

    // notify + email = high risk -> approval even in autonomous.
    const highNotify = evaluatePlaybooks(
      [pb({ id: "e", actionType: "notify", channels: ["in_app", "email"] })],
      [DECISIONS[0]!],
      "autonomous",
    );
    expect(highNotify[0]?.verdict).toBe("approval");
  });

  it("carries the triggering decision + normalized channels onto the planned run", () => {
    const runs = evaluatePlaybooks(
      [pb({ id: "p", actionType: "notify", channels: ["in_app", "email", "bogus"] })],
      [DECISIONS[0]!],
      "recommend_only",
    );
    expect(runs[0]!.channels).toEqual(["in_app", "email"]); // bogus dropped
    expect(runs[0]!.decision.id).toBe("task-overdue-1");
  });
});
