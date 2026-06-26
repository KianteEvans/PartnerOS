import { describe, it, expect } from "vitest";
import { evaluateEligibility, PROGRAM_PREREQUISITES } from "@/domain/applications/eligibility";

describe("evaluateEligibility", () => {
  it("flags a tier gap for Competency below Advanced", () => {
    const r = evaluateEligibility("Competency", "registered");
    const tier = r.prerequisites.find((p) => p.kind === "tier")!;
    expect(tier.state).toBe("gap");
    expect(tier.detail).toContain("Advanced");
    expect(tier.detail).toContain("Software-Path"); // alternative noted
    expect(r.hasTierGap).toBe(true);
    expect(r.tierMet).toBe(false);
    // Path stage is not tracked -> confirm advisory.
    expect(r.prerequisites.find((p) => p.kind === "path")!.state).toBe("confirm");
  });

  it("marks the tier met for Competency at Advanced or Premier", () => {
    expect(evaluateEligibility("Competency", "advanced").tierMet).toBe(true);
    expect(evaluateEligibility("Competency", "premier").tierMet).toBe(true);
    expect(evaluateEligibility("Competency", "advanced").hasTierGap).toBe(false);
  });

  it("requires only Select Tier for Service Delivery", () => {
    expect(evaluateEligibility("Service Delivery", "select").tierMet).toBe(true);
    const gap = evaluateEligibility("Service Delivery", "registered");
    expect(gap.hasTierGap).toBe(true);
    expect(gap.prerequisites.find((p) => p.kind === "tier")!.detail).toContain("Select");
  });

  it("has no tier prerequisite for Service Ready (path + FTR advisories)", () => {
    const r = evaluateEligibility("Service Ready", "registered");
    expect(r.hasTierGap).toBe(false);
    expect(r.tierMet).toBe(true); // vacuously: no tier items
    expect(r.prerequisites.map((p) => p.kind).sort()).toEqual(["ftr", "path"]);
    expect(r.prerequisites.every((p) => p.state === "confirm")).toBe(true);
  });

  it("requires Advanced + practice for MSP", () => {
    const r = evaluateEligibility("MSP", "select");
    expect(r.hasTierGap).toBe(true);
    expect(r.prerequisites.some((p) => p.kind === "practice")).toBe(true);
    expect(evaluateEligibility("MSP", "advanced").tierMet).toBe(true);
  });

  it("has empty prerequisites for FTR and Unknown", () => {
    expect(evaluateEligibility("FTR", "registered").prerequisites).toHaveLength(0);
    expect(evaluateEligibility("Unknown", "registered").prerequisites).toHaveLength(0);
    expect(PROGRAM_PREREQUISITES.FTR).toHaveLength(0);
  });
});
