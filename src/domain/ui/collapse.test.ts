import { describe, it, expect } from "vitest";
import {
  slugify,
  sectionOf,
  collapseKeyOf,
  parseCollapsed,
  serializeCollapsed,
  toggleKey,
} from "./collapse";

describe("collapse helpers", () => {
  it("slugifies titles and labels stably", () => {
    expect(slugify("Your moves")).toBe("your-moves");
    expect(slugify("What's driving outcomes")).toBe("what-s-driving-outcomes");
    expect(slugify("  AWS  Team  ")).toBe("aws-team");
    expect(slugify("Win rate (30d)")).toBe("win-rate-30d");
    expect(slugify("Needs attention")).toBe(slugify("needs   attention"));
  });

  it("derives the section from the first path segment", () => {
    expect(sectionOf("/ace/7f39-abc")).toBe("ace");
    expect(sectionOf("/ace")).toBe("ace");
    expect(sectionOf("/")).toBe("");
    expect(collapseKeyOf("ace", "your-moves")).toBe("ace:your-moves");
  });

  it("parses and round-trips the cookie value", () => {
    expect(parseCollapsed(undefined)).toEqual(new Set());
    expect(parseCollapsed("")).toEqual(new Set());
    expect(parseCollapsed("ace:your-moves, ,command:work")).toEqual(
      new Set(["ace:your-moves", "command:work"]),
    );
    // serialize is sorted + deduped for a stable cookie
    expect(serializeCollapsed(["b", "a", "b", ""])).toBe("a,b");
    const round = parseCollapsed(serializeCollapsed(["z:2", "z:1"]));
    expect(round).toEqual(new Set(["z:1", "z:2"]));
  });

  it("toggles a key on and off immutably", () => {
    const base = new Set(["ace:x"]);
    const collapsed = toggleKey(base, "ace:y", true);
    expect(collapsed).toEqual(new Set(["ace:x", "ace:y"]));
    expect(base).toEqual(new Set(["ace:x"])); // original untouched
    const expanded = toggleKey(collapsed, "ace:x", false);
    expect(expanded).toEqual(new Set(["ace:y"]));
  });
});
