import { describe, it, expect } from "vitest";
import { parseCopilotAnswer } from "@/domain/copilot/parse";

describe("parseCopilotAnswer", () => {
  it("extracts answer, reasoning, and nextActions from clean JSON", () => {
    const r = parseCopilotAnswer(
      '{"answer":"Focus on competencies.","reasoning":"Tier gap is the binding constraint.","nextActions":["Adopt a competency","Renew expiring evidence"]}',
    );
    expect(r.answer).toBe("Focus on competencies.");
    expect(r.reasoning).toBe("Tier gap is the binding constraint.");
    expect(r.nextActions).toEqual(["Adopt a competency", "Renew expiring evidence"]);
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const r = parseCopilotAnswer('Here you go:\n{"answer":"Do X.","nextActions":["Y"]}\nHope that helps!');
    expect(r.answer).toBe("Do X.");
    expect(r.nextActions).toEqual(["Y"]);
    expect(r.reasoning).toBe("");
  });

  it("falls back safely on malformed / non-JSON text", () => {
    const r = parseCopilotAnswer("not json at all");
    expect(r.answer).toContain("Could not parse");
    expect(r.reasoning).toBe("");
    expect(r.nextActions).toEqual([]);
  });

  it("falls back when the answer field is missing or empty", () => {
    expect(parseCopilotAnswer('{"reasoning":"x"}').answer).toBe("No answer was returned.");
    expect(parseCopilotAnswer('{"answer":"   "}').answer).toBe("No answer was returned.");
  });

  it("filters non-string nextActions and caps at 5", () => {
    const r = parseCopilotAnswer('{"answer":"ok","nextActions":["a","",null,3,"b","c","d","e","f"]}');
    expect(r.nextActions).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("clamps overly long fields", () => {
    const long = "x".repeat(3000);
    const r = parseCopilotAnswer(JSON.stringify({ answer: long, reasoning: long }));
    expect(r.answer.length).toBe(2000);
    expect(r.reasoning.length).toBe(1000);
  });
});
