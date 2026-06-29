import { describe, it, expect } from "vitest";
import { tierLadder } from "@/domain/tiers/ladder";

describe("tierLadder", () => {
  it("marks below=achieved, =current, between=upcoming, =target, above=locked", () => {
    const steps = tierLadder("select", "premier");
    expect(steps.map((s) => [s.tier, s.status])).toEqual([
      ["registered", "achieved"],
      ["select", "current"],
      ["advanced", "upcoming"],
      ["premier", "target"],
    ]);
  });

  it("adjacent target has no upcoming step", () => {
    expect(tierLadder("registered", "select").map((s) => s.status)).toEqual([
      "current",
      "target",
      "locked",
      "locked",
    ]);
  });

  it("with no target, everything above current is locked", () => {
    expect(tierLadder("advanced").map((s) => s.status)).toEqual([
      "achieved",
      "achieved",
      "current",
      "locked",
    ]);
  });

  it("carries the per-tier requirement count and label", () => {
    const steps = tierLadder("registered", "premier");
    const reqCount = (tier: string): number => steps.find((s) => s.tier === tier)!.reqCount;
    expect(reqCount("registered")).toBe(0);
    expect(reqCount("select")).toBe(3);
    expect(reqCount("advanced")).toBe(4);
    expect(reqCount("premier")).toBe(5);
    expect(steps.find((s) => s.tier === "premier")!.label).toBe("Premier");
  });
});
