import { describe, it, expect } from "vitest";
import {
  normalizeObjectives,
  pathToPreset,
  kickoffTasks,
  progressPercent,
  stepIndex,
  stageToTier,
  starterRoadmapSelection,
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

  it("kickoffTasks appends one task per stated objective (evidence is baseline-covered)", () => {
    const tasks = kickoffTasks("growth", ["cosell", "mdf", "evidence", "bogus"]);
    const keys = tasks.map((t) => t.key);
    // baseline(3) + path(1) + cosell + mdf; evidence omitted, bogus dropped
    expect(keys).toEqual(["profile", "assessment", "evidence", "path", "obj:cosell", "obj:mdf"]);
    expect(new Set(keys).size).toBe(keys.length); // stable, unique source refs
  });

  it("stageToTier maps AWS stage to a starting tier (entry by default)", () => {
    expect(stageToTier("Exploring")).toBe("registered");
    expect(stageToTier("Registered")).toBe("registered");
    expect(stageToTier("Select")).toBe("select");
    expect(stageToTier("Advanced")).toBe("advanced");
    expect(stageToTier("Premier")).toBe("premier");
    expect(stageToTier(null)).toBe("registered");
  });

  it("starterRoadmapSelection targets the next tier and seeds competencies by goal", () => {
    // Select stage + competency goal -> next tier (advanced) + 2 competency programs.
    const a = starterRoadmapSelection("growth", ["competency", "tier_advancement"], "Select");
    expect(a.targetTier).toBe("advanced");
    expect(a.programKeys.length).toBe(2);

    // Scale path, no competency goal -> tier only, no programs.
    const b = starterRoadmapSelection("scale", ["cosell"], "Registered");
    expect(b.targetTier).toBe("select");
    expect(b.programKeys).toEqual([]);

    // Premier + no competency goal -> nothing to seed (caller skips the roadmap).
    const c = starterRoadmapSelection("scale", ["cosell"], "Premier");
    expect(c.targetTier).toBeNull();
    expect(c.programKeys).toEqual([]);
  });

  it("progress advances across the wizard and tops out at done", () => {
    expect(progressPercent("context")).toBe(0);
    expect(progressPercent("path")).toBe(50);
    expect(progressPercent("done")).toBe(100);
    expect(stepIndex(WIZARD_STEPS[0]!)).toBe(0);
    expect(stepIndex("done")).toBe(-1);
  });
});
