import { describe, it, expect } from "vitest";
import {
  computeReadinessGate,
  requirementProgress,
  isExpiring,
  filterPrograms,
  portfolioCounts,
  type RequirementState,
  type PortfolioProgram,
} from "@/domain/programs/gate";

const TODAY = "2026-06-23";

const met = (evidenceApproved: boolean): RequirementState => ({ status: "met", evidenceApproved });
const open: RequirementState = { status: "open", evidenceApproved: false };
const blocked: RequirementState = { status: "blocked", evidenceApproved: false };

describe("program readiness gate", () => {
  it("ready_for_roadmap when every requirement is met with approved evidence", () => {
    expect(computeReadinessGate("pending", [met(true), met(true)], null, TODAY)).toBe("ready_for_roadmap");
  });

  it("needs_evidence when all met but evidence is missing", () => {
    expect(computeReadinessGate("pending", [met(true), met(false)], null, TODAY)).toBe("needs_evidence");
  });

  it("submission_blocked when any requirement is blocked", () => {
    expect(computeReadinessGate("pending", [met(true), blocked], null, TODAY)).toBe("submission_blocked");
  });

  it("needs_evidence when a met requirement lacks evidence even if others are open", () => {
    expect(computeReadinessGate("pending", [met(false), open], null, TODAY)).toBe("needs_evidence");
  });

  it("in_progress when work remains and met items already have evidence", () => {
    expect(computeReadinessGate("pending", [met(true), open], null, TODAY)).toBe("in_progress");
  });

  it("active programs are participating, or renewal_risk near expiration", () => {
    expect(computeReadinessGate("active", [], "2026-12-31", TODAY)).toBe("participating");
    expect(computeReadinessGate("active", [], "2026-07-15", TODAY)).toBe("renewal_risk");
    expect(computeReadinessGate("expired", [], null, TODAY)).toBe("renewal_risk");
  });

  it("requirementProgress counts met of total", () => {
    expect(requirementProgress([met(true), open, blocked])).toEqual({ met: 1, total: 3 });
  });
});

describe("program portfolio views", () => {
  const a: PortfolioProgram = { status: "active", expirationDate: "2026-12-31" }; // active, not expiring
  const b: PortfolioProgram = { status: "active", expirationDate: "2026-07-10" }; // expiring
  const c: PortfolioProgram = { status: "pending", expirationDate: null };
  const d: PortfolioProgram = { status: "submitted", expirationDate: null };
  const e: PortfolioProgram = { status: "expired", expirationDate: "2025-01-01" };
  const ALL = [a, b, c, d, e];

  it("isExpiring is active + within the renewal window", () => {
    expect(isExpiring(a, TODAY)).toBe(false);
    expect(isExpiring(b, TODAY)).toBe(true);
    expect(isExpiring(c, TODAY)).toBe(false); // pending, never "expiring"
  });

  it("filters by view", () => {
    expect(filterPrograms(ALL, "active", TODAY)).toEqual([a, b]);
    expect(filterPrograms(ALL, "pending", TODAY)).toEqual([c, d]); // pending + submitted
    expect(filterPrograms(ALL, "expiring", TODAY)).toEqual([b]);
    expect(filterPrograms(ALL, "all", TODAY)).toHaveLength(5);
  });

  it("counts the adopted views", () => {
    expect(portfolioCounts(ALL, TODAY)).toEqual({ all: 5, active: 2, pending: 2, expiring: 1 });
  });
});
