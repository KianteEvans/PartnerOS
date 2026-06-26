import { describe, it, expect } from "vitest";
import { parseNarrative } from "@/domain/programs/recommend-parse";

describe("parseNarrative", () => {
  it("parses a clean JSON object", () => {
    const r = parseNarrative('{"narrative":"Pursue Migration next.","topPick":"Migration Competency"}');
    expect(r.narrative).toBe("Pursue Migration next.");
    expect(r.topPick).toBe("Migration Competency");
  });

  it("tolerates surrounding prose", () => {
    const r = parseNarrative('Sure! Here you go:\n{"narrative":"Focus on Security.","topPick":"Security Competency"} — hope that helps');
    expect(r.narrative).toBe("Focus on Security.");
    expect(r.topPick).toBe("Security Competency");
  });

  it("defaults topPick to null when absent and clamps long narratives", () => {
    const long = "x".repeat(1000);
    const r = parseNarrative(`{"narrative":"${long}"}`);
    expect(r.topPick).toBeNull();
    expect(r.narrative.length).toBe(800);
  });

  it("never throws on malformed/empty input", () => {
    expect(parseNarrative("not json at all").narrative).toBe("Could not parse the summary.");
    expect(parseNarrative("").topPick).toBeNull();
    expect(parseNarrative("{broken").narrative).toBe("Could not parse the summary.");
  });
});
