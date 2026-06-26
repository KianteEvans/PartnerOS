import { describe, it, expect } from "vitest";
import {
  renewalReadiness,
  requiredTier,
  renewalSummary,
  LAUNCHED_OPP_TARGET,
  type RenewalInput,
} from "@/domain/solutions/renewal";

const TODAY = "2026-06-25";

// A fully compliant Competency solution.
const r = (over: Partial<RenewalInput> = {}): RenewalInput => ({
  availability: "available",
  programType: "Competency",
  solutionType: "consulting_service",
  ftrStatus: "none",
  currentTier: "advanced",
  launchedCount: 1,
  renewalDate: null,
  ...over,
});

const crit = (s: ReturnType<typeof renewalReadiness>, key: string) =>
  s.criteria.find((c) => c.key === key)!;

describe("requiredTier", () => {
  it("maps program type to the maintenance tier", () => {
    expect(requiredTier("Competency")).toBe("advanced");
    expect(requiredTier("MSP")).toBe("advanced");
    expect(requiredTier("Service Delivery")).toBe("select");
    expect(requiredTier("Specialization")).toBe("select");
    expect(requiredTier("Service Ready")).toBeNull();
  });
});

describe("renewalReadiness", () => {
  it("is compliant when every criterion passes", () => {
    const s = renewalReadiness(r(), TODAY);
    expect(s.band).toBe("compliant");
    expect(s.gapCount).toBe(0);
    expect(s.criteria.every((c) => c.ok)).toBe(true);
  });

  it("is at_risk with exactly one gap", () => {
    const s = renewalReadiness(r({ launchedCount: 0 }), TODAY);
    expect(s.band).toBe("at_risk");
    expect(s.gapCount).toBe(1);
    expect(crit(s, "launched").ok).toBe(false);
  });

  it("is non_compliant with two or more gaps", () => {
    const s = renewalReadiness(r({ launchedCount: 0, currentTier: "select" }), TODAY);
    expect(s.band).toBe("non_compliant");
    expect(s.gapCount).toBe(2);
    expect(crit(s, "tier").ok).toBe(false);
  });

  it("requires an approved FTR only for software products / Service Ready", () => {
    expect(crit(renewalReadiness(r({ solutionType: "software_product", ftrStatus: "none" }), TODAY), "ftr").ok).toBe(false);
    expect(crit(renewalReadiness(r({ solutionType: "software_product", ftrStatus: "approved" }), TODAY), "ftr").ok).toBe(true);
    expect(crit(renewalReadiness(r({ solutionType: "consulting_service", ftrStatus: "none" }), TODAY), "ftr").ok).toBe(true);
  });

  it("checks the maintenance tier per program type", () => {
    expect(crit(renewalReadiness(r({ programType: "Competency", currentTier: "select" }), TODAY), "tier").ok).toBe(false);
    expect(crit(renewalReadiness(r({ programType: "Service Delivery", currentTier: "select" }), TODAY), "tier").ok).toBe(true);
    expect(crit(renewalReadiness(r({ programType: "Service Ready", currentTier: "registered" }), TODAY), "tier").ok).toBe(true);
  });

  it("flags Active off when availability is not 'available'", () => {
    expect(crit(renewalReadiness(r({ availability: "unsupported" }), TODAY), "active").ok).toBe(false);
  });

  it("escalates a compliant solution whose renewal date is due soon / overdue", () => {
    expect(renewalReadiness(r({ renewalDate: "2026-08-01" }), TODAY).band).toBe("at_risk"); // ~37 days
    expect(renewalReadiness(r({ renewalDate: "2026-01-01" }), TODAY).band).toBe("at_risk"); // overdue
    expect(renewalReadiness(r({ renewalDate: "2027-06-01" }), TODAY).band).toBe("compliant"); // far out
  });

  it("uses LAUNCHED_OPP_TARGET as the threshold", () => {
    expect(LAUNCHED_OPP_TARGET).toBe(1);
  });
});

describe("renewalSummary", () => {
  it("counts at-risk and non-compliant", () => {
    const s = renewalSummary([
      renewalReadiness(r(), TODAY),
      renewalReadiness(r({ launchedCount: 0 }), TODAY),
      renewalReadiness(r({ launchedCount: 0, currentTier: "select" }), TODAY),
    ]);
    expect(s).toEqual({ total: 3, atRisk: 1, nonCompliant: 1 });
  });
});
