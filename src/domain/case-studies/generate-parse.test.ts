import { describe, it, expect } from "vitest";
import { parseCaseStudyDraft } from "@/domain/case-studies/generate-parse";

describe("parseCaseStudyDraft", () => {
  it("parses the five narrative aspects", () => {
    const r = parseCaseStudyDraft(
      '{"aboutCustomer":"A university.","challenge":"Security gaps.","goals":"Harden EKS.","solution":"Implemented controls.","outcomes":"Reduced risk."}',
    );
    expect(r.aboutCustomer).toBe("A university.");
    expect(r.solution).toBe("Implemented controls.");
    expect(r.outcomes).toBe("Reduced risk.");
  });
  it("extracts JSON embedded in prose", () => {
    const r = parseCaseStudyDraft('Here you go: {"aboutCustomer":"X","challenge":"","goals":"","solution":"","outcomes":""} done');
    expect(r.aboutCustomer).toBe("X");
  });
  it("defaults to empty aspects on malformed input", () => {
    expect(parseCaseStudyDraft("not json at all")).toEqual({
      aboutCustomer: "",
      challenge: "",
      goals: "",
      solution: "",
      outcomes: "",
    });
  });
  it("ignores non-string fields", () => {
    expect(parseCaseStudyDraft('{"aboutCustomer":123,"challenge":"ok"}').aboutCustomer).toBe("");
    expect(parseCaseStudyDraft('{"aboutCustomer":123,"challenge":"ok"}').challenge).toBe("ok");
  });
});
