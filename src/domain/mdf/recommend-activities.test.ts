import { describe, it, expect } from "vitest";
import { recommendActivities, type ScoredActivity } from "@/domain/mdf/recommend-activities";
import { APPROVED_ACTIVITIES } from "@/domain/mdf/activity-catalog";

const score = (rs: ScoredActivity[], key: string): number =>
  rs.find((r) => r.activity.key === key)!.score;

describe("recommendActivities", () => {
  it("returns every approved activity, sorted by score desc", () => {
    const rs = recommendActivities({ objectives: [], businessModel: null, usedCategories: new Set() });
    expect(rs).toHaveLength(APPROVED_ACTIVITIES.length);
    expect(rs.every((r) => r.activity.eligibility === "approved")).toBe(true);
    for (let i = 1; i < rs.length; i++) expect(rs[i - 1]!.score).toBeGreaterThanOrEqual(rs[i]!.score);
  });

  it("nudges activities that support a declared objective to the top", () => {
    const rs = recommendActivities({ objectives: ["build pipeline"], businessModel: null, usedCategories: new Set() });
    expect(["event", "campaign"]).toContain(rs[0]!.activity.category);
    expect(rs[0]!.rationale).toContain("Supports your goal");
  });

  it("leans on the partner's business model", () => {
    const rs = recommendActivities({ objectives: [], businessModel: "ISV", usedCategories: new Set() });
    // ISV leans campaign/content over event.
    expect(score(rs, "email-campaign")).toBeGreaterThan(score(rs, "industry-conference"));
  });

  it("favours channels the partner hasn't used yet", () => {
    const fresh = recommendActivities({ objectives: [], businessModel: null, usedCategories: new Set() });
    const used = recommendActivities({ objectives: [], businessModel: null, usedCategories: new Set(["event"]) });
    expect(score(used, "industry-conference")).toBeLessThan(score(fresh, "industry-conference"));
  });
});
