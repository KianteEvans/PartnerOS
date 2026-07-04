import { describe, it, expect } from "vitest";
import { matchCaseStudies, type MatchCaseStudy, type MatchOpp } from "@/domain/ace/case-study-match";

const opp: MatchOpp = {
  name: "Globex data lake modernization",
  accountName: "Globex",
  nextStep: "Architecture review with the migration team",
  awsNextBestActions: "",
  solutionText: "Acme Migration Services. Assessment-to-cutover migration delivery for enterprise estates.",
  programText: "Migration Competency",
};

function study(over: Partial<MatchCaseStudy> & { id: string }): MatchCaseStudy {
  return {
    title: "Untitled",
    customerName: "",
    aspectsText: "",
    completenessPercent: 0,
    hasEvidence: false,
    ...over,
  };
}

describe("matchCaseStudies", () => {
  it("ranks a same-customer study above a keyword-only study", () => {
    const out = matchCaseStudies(
      opp,
      [
        study({ id: "kw", title: "Enterprise migration factory", aspectsText: "migration cutover delivery" }),
        study({ id: "cust", title: "Globex cloud migration", customerName: "Globex" }),
      ],
      new Set(),
    );
    expect(out[0]!.id).toBe("cust");
    expect(out[0]!.reasons).toContain("Same customer");
  });

  it("excludes weak matches below the threshold", () => {
    const out = matchCaseStudies(
      opp,
      [study({ id: "weak", title: "Retail analytics dashboard", aspectsText: "storefront personalization" })],
      new Set(),
    );
    expect(out).toHaveLength(0);
  });

  it("always includes attached studies, sorted first, regardless of score", () => {
    const out = matchCaseStudies(
      opp,
      [
        study({ id: "strong", title: "Globex migration", customerName: "Globex", aspectsText: "migration" }),
        study({ id: "pinned-weak", title: "Unrelated IoT rollout" }),
      ],
      new Set(["pinned-weak"]),
    );
    expect(out.map((s) => s.id)).toEqual(["pinned-weak", "strong"]);
    expect(out[0]!.attached).toBe(true);
    expect(out[0]!.score).toBe(0);
  });

  it("caps unattached suggestions and keeps ordering deterministic", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      study({ id: `s${i}`, title: `Migration story ${i}`, aspectsText: "migration enterprise delivery" }),
    );
    const out = matchCaseStudies(opp, many, new Set(), { maxUnattached: 5 });
    expect(out).toHaveLength(5);
    // Equal scores tie-break alphabetically by title -> stable order.
    expect(out.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  it("adds completeness and evidence bonuses only to already-relevant studies", () => {
    const out = matchCaseStudies(
      opp,
      [
        study({ id: "rich-irrelevant", title: "Retail loyalty app", completenessPercent: 100, hasEvidence: true }),
        study({
          id: "relevant",
          title: "Enterprise migration delivery",
          aspectsText: "migration cutover",
          completenessPercent: 100,
          hasEvidence: true,
        }),
      ],
      new Set(),
    );
    expect(out.map((s) => s.id)).toEqual(["relevant"]);
    expect(out[0]!.reasons).toEqual(
      expect.arrayContaining(["Complete write-up", "Evidence-backed"]),
    );
  });

  it("returns [] for an empty library", () => {
    expect(matchCaseStudies(opp, [], new Set())).toEqual([]);
  });
});
