import { describe, it, expect } from "vitest";
import { layoutGraph, connectedSet, CANVAS_W } from "@/domain/graph/layout";
import type { CausalGraph } from "@/domain/graph/types";

const graph: CausalGraph = {
  kind: "causal",
  health: { score: 70, band: "fair" },
  nodes: [
    { id: "cause-1", kind: "cause", label: "C1", tone: "danger", column: "cause" },
    { id: "cause-2", kind: "cause", label: "C2", tone: "warn", column: "cause" },
    { id: "driver-ACE", kind: "driver", label: "ACE", tone: "ok", column: "driver" },
    { id: "health", kind: "health", label: "Health", tone: "warn", column: "root" },
  ],
  edges: [
    { from: "cause-1", to: "driver-ACE", weight: 0.5, tone: "danger" },
    { from: "cause-2", to: "driver-ACE", weight: 0.3, tone: "warn" },
    { from: "driver-ACE", to: "health", weight: 0.2, tone: "ok" },
  ],
};

describe("layoutGraph", () => {
  it("positions every node with numeric geometry and a fixed canvas width", () => {
    const p = layoutGraph(graph);
    expect(p.width).toBe(CANVAS_W);
    expect(p.height).toBeGreaterThanOrEqual(320);
    for (const n of p.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.w).toBeGreaterThan(0);
      expect(n.h).toBeGreaterThan(0);
    }
  });

  it("orders columns left→right: cause < driver < root", () => {
    const p = layoutGraph(graph);
    const x = (id: string) => p.nodes.find((n) => n.id === id)!.x;
    expect(x("cause-1")).toBeLessThan(x("driver-ACE"));
    expect(x("driver-ACE")).toBeLessThan(x("health"));
  });

  it("stacks nodes in the same column without overlap", () => {
    const p = layoutGraph(graph);
    const c1 = p.nodes.find((n) => n.id === "cause-1")!;
    const c2 = p.nodes.find((n) => n.id === "cause-2")!;
    expect(c1.x).toBe(c2.x);
    expect(Math.abs(c1.y - c2.y)).toBeGreaterThanOrEqual(c1.h);
  });
});

describe("connectedSet", () => {
  it("a cause highlights its path to the root only", () => {
    expect(connectedSet(graph.edges, "cause-1")).toEqual(new Set(["cause-1", "driver-ACE", "health"]));
  });

  it("a driver highlights its causes (ancestors) and the root (descendant)", () => {
    expect(connectedSet(graph.edges, "driver-ACE")).toEqual(new Set(["driver-ACE", "cause-1", "cause-2", "health"]));
  });

  it("the root highlights everything upstream", () => {
    expect(connectedSet(graph.edges, "health")).toEqual(new Set(["health", "driver-ACE", "cause-1", "cause-2"]));
  });
});
