import { describe, it, expect } from "vitest";
import { filterSubmissions, viewCounts, type SubmissionRow } from "@/domain/funding/views";

const rows: SubmissionRow[] = [
  { status: "draft", ownerUserId: "u1", title: "MAP for Globex", programKey: "map" },
  { status: "submitted", ownerUserId: "u2", title: "PoC for Initech", programKey: "poc_funding" },
  { status: "in_review", ownerUserId: "u1", title: "SAP migration", programKey: "sap_migration" },
  { status: "funded", ownerUserId: "u1", title: "VMware move", programKey: "vmware_migration" },
  { status: "rejected", ownerUserId: "u2", title: "SIF bid", programKey: "sif" },
];

describe("funding views", () => {
  it("filters by view", () => {
    const ctx = { userId: "u1" };
    expect(filterSubmissions(rows, "mine", ctx).map((r) => r.programKey)).toEqual(["map", "sap_migration", "vmware_migration"]);
    expect(filterSubmissions(rows, "open", ctx).map((r) => r.status)).toEqual(["draft", "submitted", "in_review"]);
    expect(filterSubmissions(rows, "awaiting_decision", ctx).map((r) => r.status)).toEqual(["submitted", "in_review"]);
    expect(filterSubmissions(rows, "approved", ctx).map((r) => r.status)).toEqual(["funded"]);
    expect(filterSubmissions(rows, "rejected", ctx).map((r) => r.status)).toEqual(["rejected"]);
  });

  it("searches title + program key case-insensitively", () => {
    expect(filterSubmissions(rows, "all", { userId: "u1", search: "migration" }).length).toBe(2); // sap_migration + vmware_migration keys
    expect(filterSubmissions(rows, "all", { userId: "u1", search: "MAP" }).length).toBe(1);
    expect(filterSubmissions(rows, "all", { userId: "u1", search: "vmware" }).length).toBe(1);
  });

  it("counts per view", () => {
    const counts = viewCounts(rows, { userId: "u1" });
    expect(counts.all).toBe(5);
    expect(counts.mine).toBe(3);
    expect(counts.open).toBe(3);
    expect(counts.rejected).toBe(1);
  });
});
