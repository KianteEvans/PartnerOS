import { describe, it, expect } from "vitest";
import { parseHistory, MAX_TURNS } from "@/domain/copilot/history";

describe("parseHistory", () => {
  it("returns an empty history for missing, empty, or malformed JSON", () => {
    expect(parseHistory(undefined)).toEqual({ turns: [], truncated: false });
    expect(parseHistory(null)).toEqual({ turns: [], truncated: false });
    expect(parseHistory("")).toEqual({ turns: [], truncated: false });
    expect(parseHistory("not json {")).toEqual({ turns: [], truncated: false });
  });

  it("returns an empty history when the JSON is not an array", () => {
    expect(parseHistory('{"q":"hi","a":"there"}')).toEqual({ turns: [], truncated: false });
    expect(parseHistory('"just a string"')).toEqual({ turns: [], truncated: false });
    expect(parseHistory("42")).toEqual({ turns: [], truncated: false });
  });

  it("drops malformed entries while keeping valid turns in order", () => {
    const raw = JSON.stringify([
      { q: "first?", a: "one." },
      42,
      null,
      { q: "no answer" },
      { q: 7, a: "typed wrong" },
      { q: "  ", a: "blank question" },
      { q: "second?", a: "two." },
    ]);
    const parsed = parseHistory(raw);
    expect(parsed.turns).toEqual([
      { q: "first?", a: "one." },
      { q: "second?", a: "two." },
    ]);
    expect(parsed.truncated).toBe(false);
  });

  it("clamps oversized questions and answers per turn", () => {
    const parsed = parseHistory(JSON.stringify([{ q: "x".repeat(5000), a: "y".repeat(5000) }]));
    expect(parsed.turns[0]!.q).toHaveLength(2000);
    expect(parsed.turns[0]!.a).toHaveLength(2000);
  });

  it("keeps only the LAST MAX_TURNS turns and flags the truncation", () => {
    const raw = JSON.stringify(
      Array.from({ length: MAX_TURNS + 2 }, (_, i) => ({ q: `q${i}`, a: `a${i}` })),
    );
    const parsed = parseHistory(raw);
    expect(parsed.turns).toHaveLength(MAX_TURNS);
    expect(parsed.turns[0]).toEqual({ q: "q2", a: "a2" }); // oldest two dropped
    expect(parsed.turns[MAX_TURNS - 1]).toEqual({ q: `q${MAX_TURNS + 1}`, a: `a${MAX_TURNS + 1}` });
    expect(parsed.truncated).toBe(true);
  });

  it("exactly MAX_TURNS turns is not a truncation", () => {
    const raw = JSON.stringify(
      Array.from({ length: MAX_TURNS }, (_, i) => ({ q: `q${i}`, a: `a${i}` })),
    );
    const parsed = parseHistory(raw);
    expect(parsed.turns).toHaveLength(MAX_TURNS);
    expect(parsed.truncated).toBe(false);
  });
});
