import { describe, it, expect } from "vitest";
import {
  isKnownList,
  normalizeViewQuery,
  savedViewHref,
  SAVED_VIEW_LISTS,
} from "@/domain/views/saved";

describe("saved view helpers", () => {
  it("recognizes known list keys only", () => {
    expect(isKnownList("tasks")).toBe(true);
    expect(isKnownList("ace:opportunities")).toBe(true);
    expect(isKnownList("nope")).toBe(false);
    expect(isKnownList("")).toBe(false);
  });

  it("normalizes params: sorted keys, drops empty + page", () => {
    expect(
      normalizeViewQuery({ view: "overdue", q: "acme", sort: "created", dir: "desc", page: "3" }),
    ).toBe("dir=desc&q=acme&sort=created&view=overdue");
  });

  it("drops empty/undefined values", () => {
    expect(normalizeViewQuery({ view: "all", q: "", dir: undefined })).toBe("view=all");
  });

  it("is stable regardless of key insertion order", () => {
    const a = normalizeViewQuery({ q: "x", view: "mine" });
    const b = normalizeViewQuery({ view: "mine", q: "x" });
    expect(a).toBe(b);
  });

  it("encodes special characters in values", () => {
    expect(normalizeViewQuery({ q: "a b&c" })).toBe("q=a+b%26c");
  });

  it("builds an apply href from a list key + query", () => {
    expect(savedViewHref("tasks", "view=overdue")).toBe("/command/tasks?view=overdue");
    expect(savedViewHref("ace:opportunities", "tab=opportunities&view=high_value")).toBe(
      "/ace?tab=opportunities&view=high_value",
    );
  });

  it("returns the bare base path for an empty query", () => {
    expect(savedViewHref("evidence", "")).toBe("/programs/evidence");
  });

  it("every registered list has a non-empty key, basePath, and label", () => {
    for (const l of SAVED_VIEW_LISTS) {
      expect(l.key).toBeTruthy();
      expect(l.basePath.startsWith("/")).toBe(true);
      expect(l.label).toBeTruthy();
    }
  });
});
