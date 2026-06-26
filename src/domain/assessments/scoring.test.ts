import { describe, it, expect } from "vitest";
import { PRESET_MODULES } from "@/domain/assessments/catalog";
import { scoreAssessment, type ResponseMap } from "@/domain/assessments/scoring";

/**
 * Pure scoring — no database. Deterministic inputs, exact expected outputs.
 */

const modules = PRESET_MODULES.program_submission; // gtm, competency, evidence

function responses(entries: Record<string, string>): ResponseMap {
  return new Map(Object.entries(entries));
}

describe("scoreAssessment", () => {
  it("an empty draft scores 0 overall and reports every module as a gap", () => {
    const r = scoreAssessment(modules, responses({}));
    expect(r.overall).toBe(0);
    expect(r.modules.map((m) => m.score)).toEqual([0, 0, 0]);
    expect(r.strengths).toEqual([]);
    expect(r.gaps.map((g) => g.module)).toEqual([
      "gtm",
      "competency",
      "evidence",
    ]);
    // Weakest-question keys are the lowest-scoring two, stable by key on ties.
    expect(r.gaps[0]!.weakestQuestionKeys).toEqual([
      "gtm.exec_sponsor",
      "gtm.joint_plan",
    ]);
  });

  it("all-best answers score 100 and report every module as a strength", () => {
    const r = scoreAssessment(
      modules,
      responses({
        "gtm.exec_sponsor": "yes",
        "gtm.joint_plan": "optimized",
        "gtm.pipeline": "optimized",
        "competency.case_studies": "3plus",
        "competency.tech_validation": "optimized",
        "competency.certified_staff": "yes",
        "evidence.coverage": "optimized",
        "evidence.freshness": "yes",
        "evidence.organization": "optimized",
      }),
    );
    expect(r.overall).toBe(100);
    expect(r.strengths).toEqual(["gtm", "competency", "evidence"]);
    expect(r.gaps).toEqual([]);
  });

  it("computes a weighted module score and orders gaps worst-first", () => {
    // GTM: exec_sponsor=partial(50,w1), joint_plan=established(70,w2),
    // pipeline=none(0,w2) -> (50 + 140 + 0)/5 = 38.
    const r = scoreAssessment(
      ["gtm"],
      responses({
        "gtm.exec_sponsor": "partial",
        "gtm.joint_plan": "established",
        "gtm.pipeline": "none",
      }),
    );
    expect(r.modules[0]!.score).toBe(38);
    expect(r.overall).toBe(38);
    expect(r.gaps[0]!.weakestQuestionKeys).toEqual([
      "gtm.pipeline",
      "gtm.exec_sponsor",
    ]);
  });

  it("ignores unrecognized option values (treats them as unanswered)", () => {
    const r = scoreAssessment(
      ["gtm"],
      responses({ "gtm.exec_sponsor": "bogus", "gtm.joint_plan": "optimized" }),
    );
    // Only joint_plan(100, w2) counts; weight total still 5 -> 200/5 = 40.
    expect(r.modules[0]!.score).toBe(40);
  });
});
