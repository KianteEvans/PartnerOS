import { describe, it, expect } from "vitest";
import {
  collectOperatorRefs,
  formatAttribution,
  operatorRefFromMetadata,
} from "./attribution";

describe("audit attribution (pure)", () => {
  it("extracts an operator ref from act-as metadata", () => {
    expect(operatorRefFromMetadata({ actingAsAgency: "a1", agencyOperator: "u1" })).toEqual({
      agencyId: "a1",
      operatorId: "u1",
    });
  });

  it("returns null for direct (non-delegated) actions and malformed metadata", () => {
    expect(operatorRefFromMetadata({})).toBeNull();
    expect(operatorRefFromMetadata(null)).toBeNull();
    expect(operatorRefFromMetadata(undefined)).toBeNull();
    expect(operatorRefFromMetadata("nope")).toBeNull();
    expect(operatorRefFromMetadata({ name: "x" })).toBeNull();
    expect(operatorRefFromMetadata({ actingAsAgency: "a1" })).toBeNull(); // partial
    expect(operatorRefFromMetadata({ actingAsAgency: "", agencyOperator: "u1" })).toBeNull(); // empty
  });

  it("collects DISTINCT operator+agency pairs, ignoring direct rows", () => {
    const refs = collectOperatorRefs([
      { actingAsAgency: "a1", agencyOperator: "u1" },
      { actingAsAgency: "a1", agencyOperator: "u1" }, // dupe
      { actingAsAgency: "a1", agencyOperator: "u2" },
      {}, // direct action — skipped
      { actingAsAgency: "a2", agencyOperator: "u1" },
    ]);
    expect(refs).toHaveLength(3);
    expect(refs).toContainEqual({ agencyId: "a1", operatorId: "u1" });
    expect(refs).toContainEqual({ agencyId: "a1", operatorId: "u2" });
    expect(refs).toContainEqual({ agencyId: "a2", operatorId: "u1" });
  });

  it("formats a human label with graceful fallbacks", () => {
    expect(formatAttribution("jane@obp.com", "OBP")).toBe("acted by jane@obp.com via OBP");
    expect(formatAttribution(undefined, "OBP")).toBe("acted by an agency operator via OBP");
    expect(formatAttribution("jane@obp.com", undefined)).toBe("acted by jane@obp.com");
    expect(formatAttribution(undefined, undefined)).toBe("acted by an agency operator");
  });
});
