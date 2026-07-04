import { describe, it, expect } from "vitest";
import { reconcileMilestones, type ReconcileMilestone, type MilestoneRealState } from "@/domain/roadmaps/reconcile";

function ms(over: Partial<ReconcileMilestone> = {}): ReconcileMilestone {
  return { id: "m1", title: "Earn Migration Competency", originKind: "program", originRef: "migration_competency", status: "planned", ...over };
}

const state: MilestoneRealState = {
  activeProgramKeys: new Set(["migration_competency"]),
  metTierReqKeys: new Set(["advanced:launched_count"]),
};

describe("reconcileMilestones", () => {
  it("advances a program milestone whose program is active", () => {
    const { toAdvance } = reconcileMilestones([ms()], state);
    expect(toAdvance).toHaveLength(1);
    expect(toAdvance[0]).toMatchObject({ id: "m1", reason: "Program active" });
  });

  it("advances a tier milestone whose requirement is met", () => {
    const m = ms({ id: "t1", title: "Advanced tier: launched", originKind: "tier", originRef: "advanced:launched_count" });
    const { toAdvance } = reconcileMilestones([m], state);
    expect(toAdvance).toHaveLength(1);
    expect(toAdvance[0]).toMatchObject({ id: "t1", reason: "Requirement met" });
  });

  it("advances an in_progress milestone too (forward from any non-terminal state)", () => {
    const { toAdvance } = reconcileMilestones([ms({ status: "in_progress" })], state);
    expect(toAdvance).toHaveLength(1);
  });

  it("does not advance when the real condition is unmet", () => {
    const m = ms({ originRef: "security_competency" }); // not active
    expect(reconcileMilestones([m], state).toAdvance).toHaveLength(0);
    const t = ms({ originKind: "tier", originRef: "premier:launched_count" }); // not met
    expect(reconcileMilestones([t], state).toAdvance).toHaveLength(0);
  });

  it("never touches done, blocked, or custom milestones", () => {
    expect(reconcileMilestones([ms({ status: "done" })], state).toAdvance).toHaveLength(0);
    expect(reconcileMilestones([ms({ status: "blocked" })], state).toAdvance).toHaveLength(0);
    // A custom milestone has no catalog origin to check, even if its ref collides.
    expect(reconcileMilestones([ms({ originKind: "custom" })], state).toAdvance).toHaveLength(0);
  });

  it("advances several satisfied milestones and leaves the rest", () => {
    const out = reconcileMilestones(
      [
        ms({ id: "a" }), // program active -> advance
        ms({ id: "b", originKind: "tier", originRef: "advanced:launched_count" }), // met -> advance
        ms({ id: "c", originRef: "security_competency" }), // not active -> stay
        ms({ id: "d", status: "done" }), // done -> stay
      ],
      state,
    );
    expect(out.toAdvance.map((a) => a.id)).toEqual(["a", "b"]);
  });
});
