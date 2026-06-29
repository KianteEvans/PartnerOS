import { describe, it, expect } from "vitest";
import {
  ACTIVITY_CATALOG,
  APPROVED_ACTIVITIES,
  INELIGIBLE_ACTIVITIES,
  activityByKey,
  activitiesByCategory,
} from "@/domain/mdf/activity-catalog";

const CATEGORIES = ["event", "campaign", "content", "enablement", "other"] as const;

describe("mdf activity catalog", () => {
  it("partitions cleanly into approved + ineligible with unique keys", () => {
    expect(APPROVED_ACTIVITIES.length).toBeGreaterThanOrEqual(15);
    expect(INELIGIBLE_ACTIVITIES.length).toBeGreaterThanOrEqual(12);
    expect(ACTIVITY_CATALOG.length).toBe(APPROVED_ACTIVITIES.length + INELIGIBLE_ACTIVITIES.length);
    const keys = ACTIVITY_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length); // unique
  });

  it("approved carry proof + 50% co-fund; ineligible carry a reason + 0% co-fund", () => {
    for (const a of APPROVED_ACTIVITIES) {
      expect(a.eligibility).toBe("approved");
      expect(a.proofRequirement).toBeTruthy();
      expect(a.defaultCoFundPct).toBe(50);
    }
    for (const a of INELIGIBLE_ACTIVITIES) {
      expect(a.eligibility).toBe("ineligible");
      expect(a.reason).toBeTruthy();
      expect(a.defaultCoFundPct).toBe(0);
    }
  });

  it("every category is a valid mdf_activity_type enum value", () => {
    for (const a of ACTIVITY_CATALOG) {
      expect(CATEGORIES).toContain(a.category);
    }
  });

  it("activityByKey looks up by key and is null-safe", () => {
    expect(activityByKey("third-party-event")?.label).toBe("3P Event");
    expect(activityByKey("travel")?.eligibility).toBe("ineligible");
    expect(activityByKey("nope")).toBeUndefined();
    expect(activityByKey(null)).toBeUndefined();
    expect(activityByKey(undefined)).toBeUndefined();
  });

  it("activitiesByCategory filters", () => {
    const events = activitiesByCategory("event");
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((a) => a.category === "event")).toBe(true);
  });
});
