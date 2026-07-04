import { describe, it, expect } from "vitest";
import { parseWinLossNarrative } from "@/domain/ace/winloss-ai-parse";

describe("parseWinLossNarrative", () => {
  it("parses a clean JSON payload (with surrounding prose)", () => {
    const out = parseWinLossNarrative(
      'Here you go: {"headline": "Amazon-originated deals carry the book", "insights": ["MDF-backed deals win 3x more", "Price drives most losses"]} hope that helps',
    );
    expect(out).not.toBeNull();
    expect(out!.headline).toBe("Amazon-originated deals carry the book");
    expect(out!.insights).toHaveLength(2);
  });

  it("caps lengths and insight count, drops non-strings", () => {
    const out = parseWinLossNarrative(
      JSON.stringify({
        headline: "h".repeat(500),
        insights: ["a", 42, "", "b", "c", "d", "e", "f"],
      }),
    );
    expect(out!.headline.length).toBeLessThanOrEqual(200);
    expect(out!.insights).toEqual(["a", "b", "c", "d", "e"]); // 5 max, strings only
  });

  it("returns null for malformed or empty payloads", () => {
    expect(parseWinLossNarrative("no json here")).toBeNull();
    expect(parseWinLossNarrative('{"headline": "", "insights": []}')).toBeNull();
    expect(parseWinLossNarrative("{broken")).toBeNull();
  });
});
