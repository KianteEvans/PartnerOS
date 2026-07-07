import { describe, it, expect } from "vitest";
import {
  PACKAGE_TIERS,
  MIN_TIER,
  FEATURE_LABELS,
  isIncluded,
  featureForPath,
  isPathIncluded,
  lowerOf,
  type FeatureKey,
} from "./catalog";

const FEATURES = Object.keys(MIN_TIER) as FeatureKey[];

describe("packaging catalog", () => {
  it("tiers are cumulative: anything included in a tier is included in every higher tier", () => {
    for (const f of FEATURES) {
      for (let i = 0; i < PACKAGE_TIERS.length - 1; i++) {
        if (isIncluded(PACKAGE_TIERS[i]!, f)) {
          expect(isIncluded(PACKAGE_TIERS[i + 1]!, f)).toBe(true);
        }
      }
      expect(isIncluded("enterprise", f)).toBe(true); // top tier has everything
      expect(isIncluded(null, f)).toBe(true); // no preview = full platform
    }
  });

  it("every feature has a label", () => {
    for (const f of FEATURES) {
      expect(FEATURE_LABELS[f].length).toBeGreaterThan(0);
    }
  });

  it("fences the deal desk but keeps the ACE records workspace open", () => {
    expect(featureForPath("/ace")).toBeNull();
    expect(featureForPath("/ace?tab=opportunities&q=globex")).toBeNull();
    expect(featureForPath("/ace/64d9f436-414e-4633-b9ae-1ffd4dc67e09")).toBe("deal_desk");
  });

  it("resolves the most specific route first", () => {
    expect(featureForPath("/reports/forecasts")).toBe("reports_forecasts");
    expect(featureForPath("/reports/winloss")).toBe("reports");
    expect(featureForPath("/reports")).toBe("reports");
    expect(featureForPath("/playbooks/channels")).toBe("playbooks_auto");
    expect(featureForPath("/playbooks/activity")).toBe("playbooks");
    expect(featureForPath("/command/graph")).toBe("command_graph");
    expect(featureForPath("/command/graphite")).toBeNull(); // segment boundary, not substring
  });

  it("never fences stage-progress and records surfaces", () => {
    for (const path of ["/", "/command", "/command/tasks", "/plan", "/plan/roadmaps", "/programs", "/programs/evidence", "/programs/applications", "/programs/tiers", "/settings", "/onboarding", "/portfolio"]) {
      expect(featureForPath(path)).toBeNull();
    }
  });

  it("isPathIncluded drives nav filtering per tier", () => {
    expect(isPathIncluded("essentials", "/mdf")).toBe(false);
    expect(isPathIncluded("growth", "/mdf")).toBe(true);
    expect(isPathIncluded("growth", "/reports/forecasts")).toBe(false);
    expect(isPathIncluded("enterprise", "/reports/forecasts")).toBe(true);
    expect(isPathIncluded("essentials", "/ace")).toBe(true);
    expect(isPathIncluded(null, "/funding")).toBe(true);
  });

  // lowerOf is the clamp behind the downgrade-only preview: the effective tier is
  // lowerOf(previewCookie, realPlan), so a preview can never exceed the real plan.
  it("lowerOf returns the more restrictive tier (preview never upgrades)", () => {
    expect(lowerOf("essentials", "enterprise")).toBe("essentials"); // preview lower than real
    expect(lowerOf("enterprise", "essentials")).toBe("essentials"); // preview above real -> clamped to real
    expect(lowerOf("growth", "growth")).toBe("growth");
    expect(lowerOf("essentials", "growth")).toBe("essentials");
    expect(lowerOf("enterprise", "growth")).toBe("growth");
    expect(lowerOf("growth", "enterprise")).toBe("growth");
  });
});
