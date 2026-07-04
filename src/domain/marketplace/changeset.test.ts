import { describe, it, expect } from "vitest";
import {
  publishReadiness,
  isTerminalChangeStatus,
  isInFlightChangeStatus,
  canEditListing,
  awsChangeType,
  changeSummary,
  type ListingLike,
  type DimensionLike,
} from "@/domain/marketplace/changeset";

const listing = (over: Partial<ListingLike> = {}): ListingLike => ({
  title: "Acme Analytics",
  description: "Real-time analytics for AWS workloads.",
  status: "draft",
  ...over,
});
const dim = (over: Partial<DimensionLike> = {}): DimensionLike => ({
  apiName: "users",
  name: "Per user / month",
  price: 5000,
  ...over,
});

describe("publishReadiness", () => {
  it("is ready with a title, description, and a priced dimension", () => {
    expect(publishReadiness(listing(), [dim()])).toEqual({ ready: true, issues: [] });
  });

  it("collects each missing requirement", () => {
    const res = publishReadiness(listing({ title: " ", description: "" }), []);
    expect(res.ready).toBe(false);
    expect(res.issues).toEqual([
      "A product title is required.",
      "A product description is required.",
      "At least one pricing dimension is required.",
    ]);
  });

  it("rejects negative pricing", () => {
    const res = publishReadiness(listing(), [dim({ price: -1 })]);
    expect(res.ready).toBe(false);
    expect(res.issues).toContain("Pricing dimensions cannot be negative.");
  });

  it("blocks publishing an already-published or changing listing", () => {
    expect(publishReadiness(listing({ status: "published" }), [dim()]).issues).toContain(
      "This listing is already published.",
    );
    expect(publishReadiness(listing({ status: "changing" }), [dim()]).issues).toContain(
      "A change set is already in progress.",
    );
  });
});

describe("change-set lifecycle", () => {
  it("classifies terminal vs in-flight statuses", () => {
    expect(isTerminalChangeStatus("succeeded")).toBe(true);
    expect(isTerminalChangeStatus("failed")).toBe(true);
    expect(isTerminalChangeStatus("cancelled")).toBe(true);
    expect(isTerminalChangeStatus("applying")).toBe(false);
    expect(isInFlightChangeStatus("preparing")).toBe(true);
    expect(isInFlightChangeStatus("applying")).toBe(true);
    expect(isInFlightChangeStatus("succeeded")).toBe(false);
  });

  it("blocks editing only while a change is being applied", () => {
    expect(canEditListing("draft")).toBe(true);
    expect(canEditListing("published")).toBe(true);
    expect(canEditListing("changing")).toBe(false);
  });
});

describe("awsChangeType + changeSummary", () => {
  it("maps intents to AWS change types", () => {
    expect(awsChangeType("create")).toBe("CreateProduct");
    expect(awsChangeType("update_details")).toBe("UpdateInformation");
    expect(awsChangeType("update_visibility")).toBe("UpdateVisibility");
    expect(awsChangeType("publish")).toBe("ReleaseProduct");
  });

  it("summarizes a change set from its payload", () => {
    expect(changeSummary("update_visibility", { visibility: "public" })).toBe("Update visibility -> public");
    expect(changeSummary("add_dimension", { name: "Per host" })).toBe("Add pricing dimension: Per host");
    expect(changeSummary("update_details", { title: "Acme v2" })).toBe("Update details: Acme v2");
    expect(changeSummary("publish", {})).toBe("Publish");
  });
});
