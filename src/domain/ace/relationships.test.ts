import { describe, it, expect } from "vitest";
import {
  strengthBand,
  isStaleContact,
  coverageByAccount,
  type RelationshipLike,
} from "@/domain/ace/relationships";

const TODAY = "2026-06-23";

describe("ace relationships", () => {
  it("bands strength", () => {
    expect(strengthBand(85)).toBe("strong");
    expect(strengthBand(50)).toBe("developing");
    expect(strengthBand(20)).toBe("weak");
  });

  it("flags stale contacts (incl. never-contacted)", () => {
    expect(isStaleContact({ accountName: "A", strength: 50, lastContact: null }, TODAY)).toBe(true);
    expect(isStaleContact({ accountName: "A", strength: 50, lastContact: "2026-01-01" }, TODAY)).toBe(true);
    expect(isStaleContact({ accountName: "A", strength: 50, lastContact: "2026-06-10" }, TODAY)).toBe(false);
  });

  it("computes coverage per account", () => {
    const rels: RelationshipLike[] = [
      { accountName: "Acme", strength: 80, lastContact: null },
      { accountName: "Acme", strength: 40, lastContact: null },
      { accountName: "Globex", strength: 30, lastContact: null },
    ];
    const cov = coverageByAccount(rels);
    expect(cov).toEqual([
      { account: "Acme", contacts: 2, maxStrength: 80, hasStrong: true },
      { account: "Globex", contacts: 1, maxStrength: 30, hasStrong: false },
    ]);
  });
});
