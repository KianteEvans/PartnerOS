import { describe, it, expect } from "vitest";
import { nextBestActions, buildCandidates } from "@/domain/command/next-best-action";
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
const inputs = (over: Partial<CommandInputs>): CommandInputs => ({ ...EMPTY, ...over });
const advTier = { currentTier: "select", targetTier: "advanced", status: "active" } as const;

describe("nextBestActions", () => {
  it("returns nothing for an empty workspace", () => {
    expect(nextBestActions(EMPTY, TODAY)).toEqual([]);
  });

  it("ranks positive-leverage moves, caps at topN, links each, and sorts desc", () => {
    const d = nextBestActions(
      inputs({
        tasks: [{ id: "t1", title: "Ship", status: "open", priority: "critical", ownerUserId: "u1", dueDate: "2026-01-01" }],
        tier: advTier,
        tierRequirements: [
          { key: "a", label: "A", category: "c", threshold: 2, currentValue: 2 },
          { key: "b", label: "Launched opportunities", category: "opportunities", threshold: 3, currentValue: 1 },
        ],
        awsSync: { status: "configured", lastSyncDate: TODAY, driftCount: 1 },
      }),
      TODAY,
      2,
    );
    expect(d.length).toBe(2); // topN cap (3 candidates -> 2)
    expect(d.every((a) => a.leverage > 0)).toBe(true);
    expect(d.every((a) => a.link.length > 0)).toBe(true);
    expect(d[0]!.leverage).toBeGreaterThanOrEqual(d[1]!.leverage);
  });

  it("includes an unmet gating tier requirement (the path-to-tier move)", () => {
    const cands = buildCandidates(
      inputs({ tier: advTier, tierRequirements: [{ key: "b", label: "B", category: "c", threshold: 3, currentValue: 1 }] }),
      TODAY,
    );
    expect(cands.some((c) => c.category === "tier" && c.key === "tier-b")).toBe(true);
  });

  it("skips already-met and informational tier requirements", () => {
    const cands = buildCandidates(
      inputs({
        tier: advTier,
        tierRequirements: [
          { key: "met", label: "Met", category: "c", threshold: 2, currentValue: 2 },
          { key: "fee", label: "Annual fee", category: "fee", threshold: 2500, currentValue: 0, informational: true },
        ],
      }),
      TODAY,
    );
    expect(cands.some((c) => c.category === "tier")).toBe(false);
  });

  it("tags a low-effort, high-leverage tier move as a quick win", () => {
    const d = nextBestActions(
      inputs({ tier: advTier, tierRequirements: [{ key: "b", label: "B", category: "c", threshold: 3, currentValue: 1 }] }),
      TODAY,
    );
    expect(d.find((a) => a.key === "tier-b")?.quickWin).toBe(true);
  });
});
