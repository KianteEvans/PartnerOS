import { describe, it, expect } from "vitest";
import {
  targetTierFromMilestones,
  tierCoverage,
  type CoverageMilestoneInput,
} from "@/domain/roadmaps/coverage";
import { thresholdsForTier } from "@/domain/tiers/catalog";

const tierMs = (
  tier: string,
  key: string,
  status: CoverageMilestoneInput["status"],
  targetDate: string,
): CoverageMilestoneInput => ({ originKind: "tier", originRef: `${tier}:${key}`, status, targetDate });

const programMs = (status: CoverageMilestoneInput["status"] = "planned"): CoverageMilestoneInput => ({
  originKind: "program",
  originRef: "some-program",
  status,
  targetDate: "2026-03-01",
});

// The non-informational (gating) requirement keys for a tier, in catalog order.
const gatingKeys = (tier: "select" | "advanced" | "premier") =>
  thresholdsForTier(tier).filter((r) => !r.informational).map((r) => r.key);

describe("targetTierFromMilestones", () => {
  it("is null with no tier-origin milestones", () => {
    expect(targetTierFromMilestones([programMs(), programMs("done")])).toBeNull();
  });

  it("picks the highest tier when refs mix", () => {
    expect(
      targetTierFromMilestones([
        tierMs("select", "foundational_certs", "planned", "2026-03-01"),
        tierMs("advanced", "launched_opportunities", "planned", "2026-04-01"),
      ]),
    ).toBe("advanced");
  });

  it("ignores a malformed / unknown tier token", () => {
    expect(
      targetTierFromMilestones([
        tierMs("bogus", "x", "planned", "2026-03-01"),
        tierMs("select", "foundational_certs", "planned", "2026-03-01"),
      ]),
    ).toBe("select");
    expect(targetTierFromMilestones([tierMs("bogus", "x", "planned", "2026-03-01")])).toBeNull();
  });
});

describe("tierCoverage", () => {
  it("returns null when the tier has no thresholds", () => {
    expect(tierCoverage([], thresholdsForTier("registered"), "registered")).toBeNull();
  });

  it("counts the gating requirements uncovered when only program milestones exist", () => {
    const cov = tierCoverage([programMs(), programMs("done")], thresholdsForTier("advanced"), "advanced")!;
    expect(cov.total).toBe(6); // advanced has 6 gating requirements (the fee is informational)
    expect(cov.withMilestone).toBe(0);
    expect(cov.uncovered).toBe(6);
    expect(cov.percent).toBe(0);
    expect(cov.projectedReadyDate).toBeNull();
    expect(cov.projectedComplete).toBe(false);
  });

  it("excludes the informational fee from coverage", () => {
    const cov = tierCoverage([programMs()], thresholdsForTier("advanced"), "advanced")!;
    expect(cov.requirements.map((r) => r.key)).not.toContain("annual_apn_fee");
  });

  it("rolls up mixed states and isolates the uncovered requirements", () => {
    const cov = tierCoverage(
      [
        tierMs("advanced", "accredited_technical", "done", "2026-05-01"),
        tierMs("advanced", "accredited_business", "in_progress", "2026-06-01"),
        tierMs("advanced", "foundational_certs", "planned", "2026-04-01"),
        // technical_certs, launched_opportunities, partner_business_plan intentionally missing
      ],
      thresholdsForTier("advanced"),
      "advanced",
    )!;
    expect(cov.total).toBe(6);
    expect(cov.covered).toBe(1);
    expect(cov.withMilestone).toBe(3);
    expect(cov.uncovered).toBe(3);
    expect(cov.percent).toBe(17); // round(1/6 * 100)
    const byKey = Object.fromEntries(cov.requirements.map((r) => [r.key, r.state]));
    expect(byKey["accredited_technical"]).toBe("covered");
    expect(byKey["accredited_business"]).toBe("in_progress");
    expect(byKey["foundational_certs"]).toBe("planned");
    expect(byKey["technical_certs"]).toBe("uncovered");
    expect(cov.uncoveredRequirements.map((r) => r.key)).toEqual([
      "technical_certs",
      "launched_opportunities",
      "partner_business_plan",
    ]);
  });

  it("treats a blocked milestone as planned but still 'has a milestone'", () => {
    const cov = tierCoverage(
      [tierMs("select", "launched_opportunities", "blocked", "2026-05-01")],
      thresholdsForTier("select"),
      "select",
    )!;
    expect(cov.requirements.find((r) => r.key === "launched_opportunities")!.state).toBe("planned");
    expect(cov.withMilestone).toBe(1);
    expect(cov.covered).toBe(0);
  });

  it("projectedReadyDate is the latest tier target regardless of status or order", () => {
    const cov = tierCoverage(
      [
        tierMs("select", "launched_opportunities", "done", "2026-05-01"),
        tierMs("select", "foundational_certs", "planned", "2026-09-01"),
        tierMs("select", "technical_certs", "in_progress", "2026-07-01"),
      ],
      thresholdsForTier("select"),
      "select",
    )!;
    expect(cov.projectedReadyDate).toBe("2026-09-01");
  });

  it("projectedComplete is true only when every gating requirement is done", () => {
    const allDone = gatingKeys("select").map((key, i) =>
      tierMs("select", key, "done", `2026-0${i + 1}-01`),
    );
    const all = tierCoverage(allDone, thresholdsForTier("select"), "select")!;
    expect(all.projectedComplete).toBe(true);
    expect(all.percent).toBe(100);
    expect(all.covered).toBe(5); // select has 5 gating requirements

    const partial = tierCoverage(
      [
        tierMs("select", "launched_opportunities", "in_progress", "2026-05-01"),
        ...gatingKeys("select")
          .filter((k) => k !== "launched_opportunities")
          .map((key, i) => tierMs("select", key, "done", `2026-0${i + 1}-01`)),
      ],
      thresholdsForTier("select"),
      "select",
    )!;
    expect(partial.projectedComplete).toBe(false);
  });

  it("preserves the requirement order of the gating thresholds", () => {
    const cov = tierCoverage([programMs()], thresholdsForTier("advanced"), "advanced")!;
    expect(cov.requirements.map((r) => r.key)).toEqual(gatingKeys("advanced"));
  });
});
