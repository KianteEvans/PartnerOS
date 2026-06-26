import { describe, it, expect } from "vitest";
import {
  normalizeObjectives,
  pathToPreset,
  kickoffTasks,
  progressPercent,
  stepIndex,
  WIZARD_STEPS,
} from "@/domain/onboarding/catalog";

describe("onboarding catalog", () => {
  it("normalizeObjectives keeps known keys in catalog order, drops junk/dupes", () => {
    expect(
      normalizeObjectives(["mdf", "bogus", "tier_advancement", "mdf"]),
    ).toEqual(["tier_advancement", "mdf"]);
    expect(normalizeObjectives([])).toEqual([]);
  });

  it("pathToPreset maps each guided path to its assessment preset", () => {
    expect(pathToPreset("foundations")).toBe("program_submission");
    expect(pathToPreset("growth")).toBe("growth_funding");
    expect(pathToPreset("scale")).toBe("tier_advancement");
  });

  it("kickoffTasks returns the shared baseline plus one path-specific task", () => {
    for (const path of ["foundations", "growth", "scale"] as const) {
      const tasks = kickoffTasks(path);
      expect(tasks).toHaveLength(4);
      const keys = tasks.map((t) => t.key);
      expect(keys).toEqual(["profile", "assessment", "evidence", "path"]);
      // keys are unique -> stable source_ref suffixes
      expect(new Set(keys).size).toBe(keys.length);
    }
    // path-specific task differs by path
    expect(kickoffTasks("foundations").at(-1)!.title).not.toBe(
      kickoffTasks("scale").at(-1)!.title,
    );
  });

  it("progress advances across the wizard and tops out at done", () => {
    expect(progressPercent("context")).toBe(0);
    expect(progressPercent("path")).toBe(50);
    expect(progressPercent("done")).toBe(100);
    expect(stepIndex(WIZARD_STEPS[0]!)).toBe(0);
    expect(stepIndex("done")).toBe(-1);
  });
});
