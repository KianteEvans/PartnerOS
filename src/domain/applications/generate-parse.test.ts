import { describe, it, expect } from "vitest";
import { parseControlDraft } from "@/domain/applications/generate-parse";

describe("parseControlDraft", () => {
  it("parses a clean JSON object", () => {
    const r = parseControlDraft(
      '{"response":"We deliver X.","met":"yes","confidence":80,"reasoning":"Strong evidence.","cited":["Case study A"]}',
    );
    expect(r.response).toBe("We deliver X.");
    expect(r.met).toBe("yes");
    expect(r.confidence).toBe(80);
    expect(r.citedEvidenceTitles).toEqual(["Case study A"]);
  });
  it("extracts JSON wrapped in prose", () => {
    const r = parseControlDraft('Sure: {"response":"R","met":"partial","confidence":50,"reasoning":"ok","cited":[]} done');
    expect(r.met).toBe("partial");
    expect(r.confidence).toBe(50);
  });
  it("coerces a numeric-string confidence", () => {
    expect(parseControlDraft('{"response":"r","met":"no","confidence":"42","reasoning":"x"}').confidence).toBe(42);
  });
  it("fails safe to met=no for missing/invalid met", () => {
    expect(parseControlDraft('{"response":"r","confidence":90,"reasoning":"x"}').met).toBe("no");
    expect(parseControlDraft('{"response":"r","met":"maybe","confidence":90,"reasoning":"x"}').met).toBe("no");
  });
  it("defaults cited to [] when not an array", () => {
    expect(parseControlDraft('{"response":"r","met":"yes","confidence":1,"cited":"nope"}').citedEvidenceTitles).toEqual([]);
  });
  it("truncates an oversized response", () => {
    const big = "y".repeat(5000);
    expect(parseControlDraft(`{"response":"${big}","met":"yes","confidence":1}`).response.length).toBe(4000);
  });
  it("returns a safe fallback on garbage", () => {
    const r = parseControlDraft("not json at all");
    expect(r).toEqual({
      response: "",
      met: "no",
      confidence: 0,
      reasoning: "Could not parse the suggestion.",
      citedEvidenceTitles: [],
    });
  });
});
