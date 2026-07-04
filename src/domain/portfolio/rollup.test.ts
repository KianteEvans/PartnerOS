import { describe, it, expect } from "vitest";
import { portfolioRollup, sortWorkspaces, EMPTY_ROLLUP, type WorkspaceSummary } from "./rollup";

function ws(over: Partial<WorkspaceSummary>): WorkspaceSummary {
  return {
    id: over.id ?? "x",
    name: over.name ?? "Workspace",
    slug: over.slug ?? "ws",
    tier: over.tier ?? "select",
    health: over.health ?? 70,
    band: over.band ?? "fair",
    openWork: over.openWork ?? 0,
    overdue: over.overdue ?? 0,
    renewalsDue: over.renewalsDue ?? 0,
    attention: over.attention ?? 0,
    pipeline: over.pipeline ?? 0,
    topRisk: over.topRisk ?? null,
  };
}

describe("portfolioRollup", () => {
  it("returns the empty rollup for no workspaces", () => {
    expect(portfolioRollup([])).toBe(EMPTY_ROLLUP);
  });

  it("aggregates counts, averages, and tier mix", () => {
    const r = portfolioRollup([
      ws({ tier: "advanced", health: 80, band: "strong", openWork: 3, overdue: 1, renewalsDue: 1, attention: 4, pipeline: 100 }),
      ws({ tier: "advanced", health: 40, band: "at_risk", openWork: 5, overdue: 2, renewalsDue: 0, attention: 6, pipeline: 250 }),
      ws({ tier: "select", health: 60, band: "fair", openWork: 1, overdue: 0, renewalsDue: 2, attention: 1, pipeline: 50 }),
    ]);
    expect(r.count).toBe(3);
    expect(r.avgHealth).toBe(60); // (80+40+60)/3
    expect(r.atRisk).toBe(1); // one band at_risk
    expect(r.openWork).toBe(9);
    expect(r.overdue).toBe(3);
    expect(r.renewalsDue).toBe(3);
    expect(r.pipeline).toBe(400);
    expect(r.attention).toBe(11);
    expect(r.tierMix).toEqual({ advanced: 2, select: 1 });
  });
});

describe("sortWorkspaces", () => {
  const list = [
    ws({ id: "a", name: "Beta", health: 80, overdue: 0, attention: 2, pipeline: 100 }),
    ws({ id: "b", name: "Alpha", health: 40, overdue: 3, attention: 9, pipeline: 300 }),
    ws({ id: "c", name: "Gamma", health: 40, overdue: 1, attention: 5, pipeline: 200 }),
  ];

  it("defaults to worst health first, breaking ties on overdue", () => {
    expect(sortWorkspaces(list).map((w) => w.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by attention, pipeline, and name", () => {
    expect(sortWorkspaces(list, "attention").map((w) => w.id)).toEqual(["b", "c", "a"]);
    expect(sortWorkspaces(list, "pipeline").map((w) => w.id)).toEqual(["b", "c", "a"]);
    expect(sortWorkspaces(list, "name").map((w) => w.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("does not mutate the input", () => {
    const snapshot = list.map((w) => w.id);
    sortWorkspaces(list, "name");
    expect(list.map((w) => w.id)).toEqual(snapshot);
  });
});
