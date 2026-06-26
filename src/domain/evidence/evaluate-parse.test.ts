import { describe, it, expect } from "vitest";
import { parseEvaluation } from "@/domain/evidence/evaluate-parse";

describe("parseEvaluation", () => {
  it("parses a clean JSON object", () => {
    const r = parseEvaluation('{"confidence": 82, "reasoning": "Strong type and topic match."}');
    expect(r.confidence).toBe(82);
    expect(r.reasoning).toContain("Strong");
  });
  it("extracts JSON embedded in surrounding prose", () => {
    const r = parseEvaluation('Here is my assessment: {"confidence": 40, "reasoning": "Vague title."} Hope that helps.');
    expect(r.confidence).toBe(40);
    expect(r.reasoning).toBe("Vague title.");
  });
  it("coerces a numeric-string confidence", () => {
    expect(parseEvaluation('{"confidence": "85", "reasoning": "ok"}').confidence).toBe(85);
  });
  it("clamps out-of-range confidence", () => {
    expect(parseEvaluation('{"confidence": 150, "reasoning": "x"}').confidence).toBe(100);
    expect(parseEvaluation('{"confidence": -10, "reasoning": "x"}').confidence).toBe(0);
  });
  it("defaults to a safe low score on malformed JSON", () => {
    const r = parseEvaluation("{ not valid json");
    expect(r.confidence).toBe(0);
  });
  it("defaults to 0 when confidence is missing or non-numeric", () => {
    expect(parseEvaluation('{"reasoning": "no score"}').confidence).toBe(0);
    expect(parseEvaluation('{"confidence": "high", "reasoning": "x"}').confidence).toBe(0);
  });
  it("falls back to a message when there is no JSON at all", () => {
    const r = parseEvaluation("I cannot evaluate this.");
    expect(r.confidence).toBe(0);
    expect(r.reasoning).toBeTruthy();
  });
});
