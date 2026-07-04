import { describe, it, expect } from "vitest";
import { parseCaseStudyPitch } from "./case-study-pitch-parse";

describe("parseCaseStudyPitch", () => {
  it("parses a well-formed pitch list", () => {
    const text = `{"pitches": [{"title": "Globex cloud migration", "why": "Same customer, same workload."}]}`;
    expect(parseCaseStudyPitch(text)).toEqual([
      { title: "Globex cloud migration", why: "Same customer, same workload." },
    ]);
  });

  it("tolerates prose around the JSON and trims fields", () => {
    const text = `Here you go:\n{"pitches": [{"title": "  Vandelay analytics  ", "why": " Proves the analytics angle. "}]}\nHope that helps!`;
    expect(parseCaseStudyPitch(text)).toEqual([
      { title: "Vandelay analytics", why: "Proves the analytics angle." },
    ]);
  });

  it("caps why at 200 chars and the list at 6 pitches", () => {
    const long = "x".repeat(300);
    const pitches = Array.from({ length: 8 }, (_, i) => ({ title: `Study ${i}`, why: long }));
    const parsed = parseCaseStudyPitch(JSON.stringify({ pitches }));
    expect(parsed).toHaveLength(6);
    expect(parsed![0]!.why).toHaveLength(200);
  });

  it("drops entries missing a title or why", () => {
    const text = JSON.stringify({
      pitches: [{ title: "Keep me", why: "valid" }, { title: "", why: "no title" }, { title: "No why" }, 42],
    });
    expect(parseCaseStudyPitch(text)).toEqual([{ title: "Keep me", why: "valid" }]);
  });

  it("returns null on garbage, non-array pitches, or an empty result", () => {
    expect(parseCaseStudyPitch("not json at all")).toBeNull();
    expect(parseCaseStudyPitch(`{"pitches": "nope"}`)).toBeNull();
    expect(parseCaseStudyPitch(`{"pitches": []}`)).toBeNull();
    expect(parseCaseStudyPitch(`{"pitches": [{"title": ""}]}`)).toBeNull();
  });
});
