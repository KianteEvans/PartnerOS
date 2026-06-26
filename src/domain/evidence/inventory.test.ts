import { describe, it, expect } from "vitest";
import {
  filterEvidence,
  viewCounts,
  completeness,
  renewalStatus,
  fileReadiness,
  isReadyForReview,
  type EvidenceLike,
} from "@/domain/evidence/inventory";

const TODAY = "2026-06-23";
const U1 = "user-1";

function ev(over: Partial<EvidenceLike>): EvidenceLike {
  return {
    status: "missing",
    ownerUserId: null,
    expirationDate: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

const e1 = ev({ status: "approved", ownerUserId: U1, expirationDate: "2026-07-10" }); // expiring soon
const e2 = ev({ status: "missing" }); // missing, no owner
const e3 = ev({ status: "rejected", ownerUserId: U1 });
const e4 = ev({ status: "collected", ownerUserId: U1, expirationDate: "2027-01-01" }); // ready
const e5 = ev({ status: "in_review", ownerUserId: null, expirationDate: "2026-01-01" }); // needs owner, expired
const e6 = ev({ status: "approved", ownerUserId: U1, expirationDate: "2026-06-01" }); // expired

const ALL = [e1, e2, e3, e4, e5, e6];
const ctx = { today: TODAY };

describe("evidence inventory", () => {
  it("partitions the priority-filter views", () => {
    expect(filterEvidence(ALL, "missing", ctx)).toEqual([e2]);
    expect(filterEvidence(ALL, "rejected", ctx)).toEqual([e3]);
    expect(filterEvidence(ALL, "expiring_soon", ctx)).toEqual([e1]);
    expect(filterEvidence(ALL, "needs_owner", ctx)).toEqual([e5]);
    expect(filterEvidence(ALL, "ready_for_review", ctx)).toEqual([e4]);
    expect(filterEvidence(ALL, "all", ctx)).toHaveLength(6);
  });

  it("counts each view", () => {
    expect(viewCounts(ALL, ctx)).toEqual({
      all: 6,
      missing: 1,
      rejected: 1,
      expiring_soon: 1,
      needs_owner: 1,
      ready_for_review: 1,
    });
  });

  it("computes renewal status from expiration vs today", () => {
    expect(renewalStatus(e1, TODAY)).toBe("expiring");
    expect(renewalStatus(e4, TODAY)).toBe("current");
    expect(renewalStatus(e6, TODAY)).toBe("expired");
    expect(renewalStatus(e2, TODAY)).toBe("none");
  });

  it("ready-for-review requires owner, collectible status, and not expired", () => {
    expect(isReadyForReview(e4, TODAY)).toBe(true);
    expect(isReadyForReview(e5, TODAY)).toBe(false); // no owner + expired
  });

  it("completeness is the approved share of total", () => {
    expect(completeness(ALL)).toEqual({ total: 6, approved: 2, missing: 1, percent: 33 });
    expect(completeness([])).toEqual({ total: 0, approved: 0, missing: 0, percent: 0 });
  });

  it("file readiness is fail-closed", () => {
    expect(fileReadiness(null)).toBe("none");
    expect(fileReadiness("pending")).toBe("scanning");
    expect(fileReadiness("clean")).toBe("ready");
    expect(fileReadiness("infected")).toBe("blocked");
    expect(fileReadiness("error")).toBe("blocked");
  });
});
