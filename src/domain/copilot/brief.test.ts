import { describe, it, expect } from "vitest";
import { compileWorkspaceBrief } from "@/domain/copilot/brief";
import type { CommandCenter } from "@/domain/command/aggregate";
import type { Decision } from "@/domain/command/brief";
import type { RankedAction } from "@/domain/command/next-best-action";
import type { TierPath } from "@/domain/tiers/path";

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: "d1",
    severity: "critical",
    situation: "overdue_work",
    title: "Clear overdue task",
    detail: "Due 2026-06-01.",
    ownerUserId: null,
    dueDate: "2026-06-01",
    link: "/command/tasks",
    ...over,
  };
}

function action(over: Partial<RankedAction> = {}): RankedAction {
  return {
    key: "tier-competencies",
    title: "Meet tier requirement: Competencies",
    detail: "1/3 toward Premier.",
    link: "/programs/tiers",
    category: "tier",
    effort: "low",
    impact: { healthDelta: 4, tierPctDelta: 12, queueDelta: 0 },
    leverage: 11.2,
    quickWin: true,
    ...over,
  };
}

function cc(over: Partial<CommandCenter> = {}): CommandCenter {
  return {
    health: {
      score: 72,
      band: "fair",
      drivers: [
        { label: "Evidence", score: 80 },
        { label: "ACE", score: 60 },
      ],
    },
    work: { open: 5, overdue: 2, blocked: 1, critical: 1 },
    decisions: [decision()],
    topRisk: decision(),
    requiredDecision: null,
    nextBestActions: [action()],
    progress: { programsActive: 3, programsTotal: 5, tasksDone: 8, tasksTotal: 12, tierPercent: 33 },
    ...over,
  };
}

function tierPath(over: Partial<TierPath> = {}): TierPath {
  return {
    achievable: false,
    remaining: 4,
    scenarios: [
      { id: "aggressive", label: "Aggressive", etaDate: "2026-10-01", steps: [] },
      { id: "steady", label: "Steady", etaDate: "2027-01-01", steps: [] },
      { id: "deliberate", label: "Deliberate", etaDate: "2027-04-01", steps: [] },
    ],
    ...over,
  };
}

describe("compileWorkspaceBrief", () => {
  it("includes health score, band, and drivers", () => {
    const brief = compileWorkspaceBrief(cc(), tierPath(), "Select", "Premier", "2026-07-01");
    expect(brief).toContain("as of 2026-07-01");
    expect(brief).toContain("72/100 (fair)");
    expect(brief).toContain("Evidence 80");
    expect(brief).toContain("ACE 60");
  });

  it("includes the tier line with steady ETA and remaining count", () => {
    const brief = compileWorkspaceBrief(cc(), tierPath(), "Select", "Premier", "2026-07-01");
    expect(brief).toContain("Select → Premier");
    expect(brief).toContain("33% ready");
    expect(brief).toContain("4 requirements remaining");
    expect(brief).toContain("2027-01-01"); // steady scenario ETA, not aggressive/deliberate
  });

  it("lists top decisions and next-best moves with projected impact", () => {
    const brief = compileWorkspaceBrief(cc(), tierPath(), "Select", "Premier", "2026-07-01");
    expect(brief).toContain("[critical] Clear overdue task");
    expect(brief).toContain("Meet tier requirement: Competencies");
    expect(brief).toContain("health +4");
    expect(brief).toContain("tier +12%");
    expect(brief).toContain("quick win");
  });

  it("handles no active tier plan (null tierPercent, null path)", () => {
    const brief = compileWorkspaceBrief(
      cc({ progress: { programsActive: 0, programsTotal: 0, tasksDone: 0, tasksTotal: 0, tierPercent: null } }),
      null,
      "Select",
      "Premier",
      "2026-07-01",
    );
    expect(brief).toContain("no active advancement plan");
    expect(brief).not.toContain("% ready");
  });

  it("caps decisions at 5 and moves at 3", () => {
    const many = cc({
      decisions: Array.from({ length: 8 }, (_, i) => decision({ id: `d${i}`, title: `Item ${i}` })),
      nextBestActions: Array.from({ length: 6 }, (_, i) => action({ key: `a${i}`, title: `Move ${i}` })),
    });
    const brief = compileWorkspaceBrief(many, tierPath(), "Select", "Premier", "2026-07-01");
    expect(brief).toContain("Item 4");
    expect(brief).not.toContain("Item 5");
    expect(brief).toContain("Move 2");
    expect(brief).not.toContain("Move 3");
  });
});
