import { describe, it, expect } from "vitest";
import { listingView, type ListingViewRow } from "@/domain/marketplace/listing-view";

const row = (over: Partial<ListingViewRow> & { title: string }): ListingViewRow => ({
  productType: "saas",
  visibility: "public",
  status: "draft",
  dimensionCount: 0,
  lastSyncedAt: null,
  ...over,
});

const params = (over: Partial<Parameters<typeof listingView>[1]>): Parameters<typeof listingView>[1] => ({
  q: "",
  sort: "title",
  dir: "asc",
  offset: 0,
  pageSize: 25,
  ...over,
});

describe("listingView", () => {
  const rows = [
    row({ title: "Beta Platform", dimensionCount: 3, status: "published" }),
    row({ title: "Acme Analytics", dimensionCount: 1, status: "draft" }),
    row({ title: "Gamma Gateway", dimensionCount: 2, status: "published" }),
  ];

  it("sorts by title ascending and descending", () => {
    expect(listingView(rows, params({ sort: "title", dir: "asc" })).rows.map((r) => r.title)).toEqual([
      "Acme Analytics",
      "Beta Platform",
      "Gamma Gateway",
    ]);
    expect(listingView(rows, params({ sort: "title", dir: "desc" })).rows.map((r) => r.title)).toEqual([
      "Gamma Gateway",
      "Beta Platform",
      "Acme Analytics",
    ]);
  });

  it("sorts numerically by dimension count", () => {
    expect(listingView(rows, params({ sort: "dims", dir: "desc" })).rows.map((r) => r.dimensionCount)).toEqual([
      3, 2, 1,
    ]);
  });

  it("filters by case-insensitive title substring and reports the filtered total", () => {
    const out = listingView(rows, params({ q: "gamma" }));
    expect(out.total).toBe(1);
    expect(out.rows.map((r) => r.title)).toEqual(["Gamma Gateway"]);
  });

  it("paginates with offset + pageSize while total stays the full filtered count", () => {
    const out = listingView(rows, params({ sort: "title", dir: "asc", offset: 1, pageSize: 1 }));
    expect(out.total).toBe(3);
    expect(out.rows.map((r) => r.title)).toEqual(["Beta Platform"]);
  });
});
