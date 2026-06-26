import { describe, it, expect } from "vitest";
import {
  RESPONSE_GUIDANCE,
  programGuidance,
  buildUserContent,
  SYSTEM_PROMPT,
  type GenerateInput,
} from "@/domain/applications/guidance";

const base: GenerateInput = {
  programType: "Competency",
  competencyName: "Security",
  sectionName: "Overview",
  controlId: "GEN-001",
  requirement: "Demonstrate CI/CD mastery",
  evidence: [{ title: "Acme case study", notes: "EKS secrets", type: "case_study", status: "approved" }],
};

describe("RESPONSE_GUIDANCE", () => {
  it("encodes the AWS do/don't rules", () => {
    expect(RESPONSE_GUIDANCE).toMatch(/superlatives/i);
    expect(RESPONSE_GUIDANCE.toLowerCase()).toContain("cite the supporting evidence");
    expect(RESPONSE_GUIDANCE.toLowerCase()).toContain("do not repeat the requirement");
  });
});

describe("programGuidance", () => {
  it("returns a per-program emphasis (empty for Unknown)", () => {
    expect(programGuidance("Service Ready")).toContain("Service Ready");
    expect(programGuidance("MSP")).toContain("managed-service");
    expect(programGuidance("Unknown")).toBe("");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("embeds the response guidance + the JSON contract", () => {
    expect(SYSTEM_PROMPT).toContain(RESPONSE_GUIDANCE);
    expect(SYSTEM_PROMPT).toContain('"met":"yes|no|partial"');
  });
});

describe("buildUserContent", () => {
  it("includes the program label + hint, requirement, and grounded evidence", () => {
    const u = buildUserContent(base);
    expect(u).toContain("Program: Competency - Security");
    expect(u).toContain(programGuidance("Competency"));
    expect(u).toContain("Requirement: Demonstrate CI/CD mastery");
    expect(u).toContain("- [case_study, approved] Acme case study -- EKS secrets");
  });
  it("marks the AWS example answer as a style reference only", () => {
    const u = buildUserContent({ ...base, exampleResponse: "Our customer is a university..." });
    expect(u).toContain("STYLE reference only");
  });
  it("handles no evidence + an unknown program (no hint line)", () => {
    const u = buildUserContent({ ...base, programType: "Unknown", competencyName: "", evidence: [] });
    expect(u).toContain("Program: (unspecified)");
    expect(u).toContain("(no evidence on file)");
    expect(u).not.toContain("Program emphasis");
  });
});
