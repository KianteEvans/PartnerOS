import { describe, it, expect } from "vitest";
import { listingLifecycleSteps } from "@/domain/marketplace/listing-lifecycle";

describe("listingLifecycleSteps", () => {
  it("marks Draft current for a draft listing", () => {
    expect(listingLifecycleSteps("draft").map((s) => s.state)).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("marks Publishing current while a change set is in flight", () => {
    expect(listingLifecycleSteps("changing").map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
  });

  it("marks Published current once live", () => {
    expect(listingLifecycleSteps("published").map((s) => s.state)).toEqual(["done", "done", "current"]);
  });

  it("treats archived as a completed path (Badge conveys de-listing)", () => {
    expect(listingLifecycleSteps("archived").map((s) => s.state)).toEqual(["done", "done", "current"]);
  });

  it("always returns the three named steps in order", () => {
    expect(listingLifecycleSteps("draft").map((s) => s.key)).toEqual(["draft", "changing", "published"]);
  });
});
