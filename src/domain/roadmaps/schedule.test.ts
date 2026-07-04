import { describe, it, expect } from "vitest";
import {
  analyzeSchedule,
  wouldCreateCycle,
  type ScheduleMilestone,
  type DepNode,
} from "@/domain/roadmaps/schedule";

const m = (
  id: string,
  sequence: number,
  targetDate: string,
  dependsOnId: string | null = null,
): ScheduleMilestone => ({ id, sequence, targetDate, dependsOnId });

describe("analyzeSchedule", () => {
  it("handles an empty roadmap", () => {
    expect(analyzeSchedule([])).toEqual({ conflicts: [], criticalPath: [], slackByEdge: {} });
  });

  it("a well-ordered linear chain has no conflicts and full critical path", () => {
    const r = analyzeSchedule([
      m("a", 1, "2026-02-01"),
      m("b", 2, "2026-03-01", "a"),
      m("c", 3, "2026-04-01", "b"),
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.criticalPath).toEqual(["a", "b", "c"]);
    expect(r.slackByEdge).toEqual({ a: 28, b: 31, c: null }); // Feb 2026 = 28 days
  });

  it("milestones with no dependencies: latest is a one-node critical path, all slack null", () => {
    const r = analyzeSchedule([m("a", 1, "2026-02-01"), m("b", 2, "2026-03-01"), m("c", 3, "2026-01-15")]);
    expect(r.conflicts).toEqual([]);
    expect(r.criticalPath).toEqual(["b"]);
    expect(r.slackByEdge).toEqual({ a: null, b: null, c: null });
  });

  it("flags a milestone scheduled before its dependency", () => {
    const r = analyzeSchedule([m("a", 1, "2026-03-01"), m("b", 2, "2026-02-01", "a")]);
    expect(r.conflicts).toEqual([{ id: "b", dependsOnId: "a", predecessorSequence: 1 }]);
    expect(r.criticalPath).toEqual(["a"]); // a is the latest-dated
    expect(r.slackByEdge["a"]).toBe(-28);
    expect(r.slackByEdge["b"]).toBeNull();
  });

  it("treats an equal-date dependency as a conflict with zero slack", () => {
    const r = analyzeSchedule([m("a", 1, "2026-03-01"), m("b", 2, "2026-03-01", "a")]);
    expect(r.conflicts.map((c) => c.id)).toEqual(["b"]);
    expect(r.slackByEdge["a"]).toBe(0);
  });

  it("on a branch, slack is measured against the tightest (earliest) successor", () => {
    const r = analyzeSchedule([
      m("a", 1, "2026-02-01"),
      m("b", 2, "2026-04-01", "a"),
      m("c", 3, "2026-03-01", "a"),
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.criticalPath).toEqual(["a", "b"]); // finish = b (latest)
    expect(r.slackByEdge["a"]).toBe(28); // a -> c (earliest successor, Mar 1)
    expect(r.slackByEdge["b"]).toBeNull();
    expect(r.slackByEdge["c"]).toBeNull();
  });

  it("a branch can conflict off the critical path", () => {
    const r = analyzeSchedule([
      m("a", 1, "2026-02-01"),
      m("b", 2, "2026-05-01", "a"),
      m("c", 3, "2026-01-20", "a"),
    ]);
    expect(r.conflicts.map((c) => c.id)).toEqual(["c"]);
    expect(r.criticalPath).toEqual(["a", "b"]);
    expect(r.slackByEdge["a"]).toBe(-12); // a -> c, daysBetween(Feb 1, Jan 20)
  });

  it("critical path follows dependencies, not raw sequence", () => {
    const r = analyzeSchedule([
      m("a", 1, "2026-01-01"),
      m("b", 2, "2026-02-01", "a"),
      m("c", 3, "2026-03-01", "b"),
      m("d", 4, "2026-02-15", "a"),
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.criticalPath).toEqual(["a", "b", "c"]); // finish = c
  });
});

describe("wouldCreateCycle", () => {
  const chain: DepNode[] = [
    { id: "a", sequence: 1, dependsOnId: null },
    { id: "b", sequence: 2, dependsOnId: "a" },
    { id: "c", sequence: 3, dependsOnId: "b" },
  ];

  it("detects a transitive back-edge", () => {
    expect(wouldCreateCycle(chain, "a", "c")).toBe(true);
    expect(wouldCreateCycle(chain, "a", "b")).toBe(true);
  });

  it("allows an edge between independent nodes", () => {
    const nodes: DepNode[] = [
      { id: "a", sequence: 1, dependsOnId: null },
      { id: "b", sequence: 2, dependsOnId: null },
    ];
    expect(wouldCreateCycle(nodes, "b", "a")).toBe(false);
  });

  it("rejects a self-reference", () => {
    expect(wouldCreateCycle(chain, "a", "a")).toBe(true);
  });
});
