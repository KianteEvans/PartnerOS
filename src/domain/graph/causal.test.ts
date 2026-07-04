import { describe, it, expect } from "vitest";
import { buildCausalGraph } from "@/domain/graph/causal";
import { nextBestActions } from "@/domain/command/next-best-action";
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

const overdueTask = (id: string) => ({
  id,
  title: `Task ${id}`,
  status: "open" as const,
  priority: "critical" as const,
  ownerUserId: "u1",
  dueDate: "2026-01-01",
});

const atRiskOpp = {
  id: "o1",
  name: "Big deal",
  status: "open" as const,
  stage: "qualified" as const,
  amount: 200_000,
  source: "amazon_originated" as const,
  ownerUserId: "u1",
  nextStep: "x",
  lastInteraction: "2026-01-01",
  closeDate: "2026-09-01",
  routingStatus: "routed" as const,
  accountName: "Acme",
  awsContactId: null,
};

const tier = { currentTier: "select", targetTier: "advanced", status: "in_progress" };
const unmetReq = {
  key: "launched",
  label: "Launched opportunities",
  category: "delivery",
  threshold: 5,
  currentValue: 1,
  informational: false,
};

describe("buildCausalGraph", () => {
  it("an empty workspace is 6 drivers + root, no causes", () => {
    const g = buildCausalGraph(EMPTY, TODAY);
    expect(g.health).toEqual({ score: 70, band: "fair" });
    expect(g.nodes.filter((n) => n.kind === "driver")).toHaveLength(6);
    expect(g.nodes.filter((n) => n.kind === "health")).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "cause")).toHaveLength(0);
    // Exactly one driver→health edge per driver.
    expect(g.edges.filter((e) => e.to === "health")).toHaveLength(6);
  });

  it("driver→health edges carry the health WEIGHTS", () => {
    const g = buildCausalGraph(EMPTY, TODAY);
    const w = (label: string) => g.edges.find((e) => e.from === `driver-${label}` && e.to === "health");
    expect(w("ACE")?.weight).toBe(0.2);
    expect(w("Tier")?.weight).toBe(0.1);
    expect(w("MDF")?.weight).toBe(0.15);
    expect(w("ACE")?.label).toBe("20%");
    expect(w("Tier")?.label).toBe("10%");
  });

  it("driver node tone follows the score thresholds; at-risk root is danger", () => {
    // Many overdue tasks tank the Tasks driver and the composite score.
    const g = buildCausalGraph(
      inputs({ tasks: [overdueTask("a"), overdueTask("b"), overdueTask("c")] }),
      TODAY,
    );
    const tasks = g.nodes.find((n) => n.id === "driver-Tasks");
    expect(tasks?.tone).toBe("danger"); // 3/3 overdue → score 0
    expect(g.nodes.find((n) => n.kind === "health")?.tone).toBe(g.health.band === "strong" ? "ok" : g.health.band === "fair" ? "warn" : "danger");
  });

  it("groups causes under the right driver", () => {
    const g = buildCausalGraph(
      inputs({ tasks: [overdueTask("t1")], opportunities: [atRiskOpp], tier, tierRequirements: [unmetReq] }),
      TODAY,
    );
    expect(g.nodes.some((n) => n.id === "cause-task-overdue-t1")).toBe(true);
    expect(g.nodes.some((n) => n.id === "cause-opp-o1")).toBe(true);
    expect(g.nodes.some((n) => n.id === "cause-tier-launched")).toBe(true);
    // The task cause is wired to the Tasks driver.
    expect(g.edges.some((e) => e.from === "cause-task-overdue-t1" && e.to === "driver-Tasks")).toBe(true);
    expect(g.edges.some((e) => e.from === "cause-tier-launched" && e.to === "driver-Tier")).toBe(true);
  });

  it("cause impact is IDENTICAL to the next-best-action ranker (the 'matches Your Move' guarantee)", () => {
    const scenario = inputs({ tasks: [overdueTask("t1")], opportunities: [atRiskOpp], tier, tierRequirements: [unmetReq] });
    const g = buildCausalGraph(scenario, TODAY);
    const ranked = nextBestActions(scenario, TODAY, Number.MAX_SAFE_INTEGER);

    const taskCause = g.nodes.find((n) => n.id === "cause-task-overdue-t1");
    const taskAction = ranked.find((a) => a.key === "task-t1");
    expect(taskCause?.impact).toEqual(taskAction?.impact);
    expect(taskCause?.link).toBe(taskAction?.link);

    const tierCause = g.nodes.find((n) => n.id === "cause-tier-launched");
    const tierAction = ranked.find((a) => a.key === "tier-launched");
    expect(tierCause?.impact).toEqual(tierAction?.impact);
  });

  it("caps causes per driver at 4 and appends a '+N more' node", () => {
    const many = Array.from({ length: 6 }, (_, i) => overdueTask(`t${i}`));
    const g = buildCausalGraph(inputs({ tasks: many }), TODAY);
    const taskCauses = g.nodes.filter((n) => n.column === "cause" && n.id.startsWith("cause-task-"));
    expect(taskCauses).toHaveLength(4); // capped
    const more = g.nodes.find((n) => n.id === "cause-more-Tasks");
    expect(more?.label).toBe("+2 more");
    expect(g.edges.some((e) => e.from === "cause-more-Tasks" && e.to === "driver-Tasks")).toBe(true);
  });

  it("omits marketplace / aws-sync situations (not health drivers)", () => {
    const g = buildCausalGraph(
      inputs({
        awsSync: { status: "configured", lastSyncDate: "2026-01-01", driftCount: 3 },
      }),
      TODAY,
    );
    // A drift decision exists in the queue but is not a health driver → no cause node for it.
    expect(g.nodes.some((n) => n.id.startsWith("cause-aws"))).toBe(false);
  });
});
