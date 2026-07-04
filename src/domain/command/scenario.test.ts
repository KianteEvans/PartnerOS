import { describe, it, expect } from "vitest";
import { composeScenario } from "@/domain/command/scenario";
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

// Two overdue tasks + one expiring evidence -> three independent candidates whose
// transforms each remove exactly their own decision.
const populated = inputs({
  tasks: [
    { id: "t1", title: "Ship deck", status: "open", priority: "high", ownerUserId: "u1", dueDate: "2026-01-01" },
    { id: "t2", title: "File claim", status: "blocked", priority: "medium", ownerUserId: "u1", dueDate: null },
  ],
  evidence: [
    { id: "e1", title: "SOC 2", status: "collected", ownerUserId: "u1", expirationDate: "2026-07-10", createdAt: new Date("2026-01-01") },
  ],
});

describe("composeScenario", () => {
  it("chains selected candidates and stacks their queue reductions", () => {
    const one = composeScenario(populated, ["task-t1"], TODAY);
    expect(one.steps).toHaveLength(1);
    expect(one.delta.queueDelta).toBe(1);

    const all = composeScenario(populated, ["task-t1", "task-t2", "evidence-e1"], TODAY);
    expect(all.steps).toHaveLength(3);
    expect(all.delta.queueDelta).toBe(3); // each transform removes its own decision
    expect(all.result.queueLen).toBe(all.baseline.queueLen - 3);
    expect(all.delta.healthDelta).toBeGreaterThan(0);
  });

  it("is order-independent: URL key order cannot change the outcome", () => {
    const a = composeScenario(populated, ["evidence-e1", "task-t2", "task-t1"], TODAY);
    const b = composeScenario(populated, ["task-t1", "evidence-e1", "task-t2"], TODAY);
    expect(a.delta).toEqual(b.delta);
    expect(a.appliedKeys).toEqual(b.appliedKeys); // stable enumeration order
    expect(a.result).toEqual(b.result);
  });

  it("drops unknown/stale keys and reports them", () => {
    const s = composeScenario(populated, ["task-t1", "task-gone", "opp-nope"], TODAY);
    expect(s.appliedKeys).toEqual(["task-t1"]);
    expect(s.droppedKeys).toEqual(["task-gone", "opp-nope"]);
    expect(s.steps).toHaveLength(1);
  });

  it("the final cumulative step equals the scenario delta", () => {
    const s = composeScenario(populated, ["task-t1", "task-t2"], TODAY);
    expect(s.steps[s.steps.length - 1]!.cumulative).toEqual(s.delta);
    // Cumulative queue reduction grows monotonically across these independent steps.
    expect(s.steps[0]!.cumulative.queueDelta).toBe(1);
    expect(s.steps[1]!.cumulative.queueDelta).toBe(2);
  });

  it("flips the health band when the composed score crosses a threshold", () => {
    // Tasks driver 0 (all overdue) AND ACE driver 0 (all open deals at risk) drags the
    // baseline below 50 (at_risk); fixing both lifts it back to fair.
    const bandCase = inputs({
      tasks: [{ id: "t1", title: "a", status: "open", priority: "high", ownerUserId: "u1", dueDate: "2026-01-01" }],
      opportunities: [
        { id: "o1", name: "Whale", status: "open", stage: "qualified", amount: 300_000, source: "partner_originated", ownerUserId: "u1", nextStep: "x", lastInteraction: "2026-01-01", closeDate: "2026-02-01", routingStatus: "routed", accountName: "A", awsContactId: null },
      ],
    });
    const s = composeScenario(bandCase, ["task-t1", "opp-o1"], TODAY);
    expect(s.baseline.band).toBe("at_risk");
    expect(s.result.health).toBeGreaterThan(s.baseline.health);
    expect(s.baseline.band).not.toBe(s.result.band);
  });

  it("an empty or fully-invalid selection is a zero-delta scenario", () => {
    const none = composeScenario(populated, [], TODAY);
    expect(none.steps).toHaveLength(0);
    expect(none.delta).toEqual({ healthDelta: 0, tierPctDelta: 0, queueDelta: 0 });
    expect(none.result).toEqual(none.baseline);
    const invalid = composeScenario(populated, ["nope"], TODAY);
    expect(invalid.steps).toHaveLength(0);
    expect(invalid.droppedKeys).toEqual(["nope"]);
  });
});
