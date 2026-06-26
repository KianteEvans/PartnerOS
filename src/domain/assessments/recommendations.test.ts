import { describe, it, expect } from "vitest";
import { PRESET_MODULES } from "@/domain/assessments/catalog";
import { scoreAssessment, type ResponseMap } from "@/domain/assessments/scoring";
import { generateRecommendations } from "@/domain/assessments/recommendations";

const modules = PRESET_MODULES.program_submission; // gtm, competency, evidence

function responses(entries: Record<string, string>): ResponseMap {
  return new Map(Object.entries(entries));
}

const allBest = responses({
  "gtm.exec_sponsor": "yes",
  "gtm.joint_plan": "optimized",
  "gtm.pipeline": "optimized",
  "competency.case_studies": "3plus",
  "competency.tech_validation": "optimized",
  "competency.certified_staff": "yes",
  "evidence.coverage": "optimized",
  "evidence.freshness": "yes",
  "evidence.organization": "optimized",
});

describe("generateRecommendations", () => {
  it("emits a task per gap, an evidence_gap, a milestone, and a program rec", () => {
    const result = scoreAssessment(modules, responses({})); // all gaps
    const recs = generateRecommendations(result, {
      preset: "program_submission",
      targetProgram: "Migration Competency",
    });

    const byType = recs.reduce<Record<string, number>>((acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType.task).toBe(3); // gtm, competency, evidence
    expect(byType.evidence_gap).toBe(1);
    expect(byType.milestone).toBe(1);
    expect(byType.program).toBe(1);

    const program = recs.find((r) => r.type === "program")!;
    expect(program.title).toBe("Build readiness for Migration Competency");
    expect(program.payload.ready).toBe(false);

    // Every confidence stays within bounds.
    for (const r of recs) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("recommends submission and no remediation when fully ready", () => {
    const result = scoreAssessment(modules, allBest); // overall 100, no gaps
    const recs = generateRecommendations(result, {
      preset: "program_submission",
      targetProgram: "Migration Competency",
    });

    expect(recs.filter((r) => r.type === "task")).toHaveLength(0);
    expect(recs.filter((r) => r.type === "evidence_gap")).toHaveLength(0);
    expect(recs.filter((r) => r.type === "milestone")).toHaveLength(0);

    const program = recs.find((r) => r.type === "program")!;
    expect(program.title).toBe("Submit for Migration Competency");
    expect(program.payload.ready).toBe(true);
  });

  it("omits the program rec when there is no target program", () => {
    const result = scoreAssessment(modules, responses({}));
    const recs = generateRecommendations(result, {
      preset: "custom",
      targetProgram: null,
    });
    expect(recs.some((r) => r.type === "program")).toBe(false);
  });
});
