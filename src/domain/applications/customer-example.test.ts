import { describe, it, expect } from "vitest";
import {
  aspectForControl,
  isCustomerExampleControl,
  buildCustomerExampleFills,
  type ControlForFill,
  type CaseStudyForFill,
} from "@/domain/applications/customer-example";

const cs = (over: Partial<CaseStudyForFill> = {}): CaseStudyForFill => ({
  aboutCustomer: "About",
  challenge: "Challenge",
  goals: "Goals",
  solution: "Solution",
  outcomes: "Outcomes",
  ...over,
});

// A customer-example control with two reference columns (refLabel set).
const ucr1: ControlForFill = {
  sheetName: "Common Cust Example Reqs",
  controlId: "UCR-001",
  requirement: "About the Customer",
  responseTargets: [
    { refLabel: "Customer Reference #1", metAddress: "D7", responseAddress: "E7" },
    { refLabel: "Customer Reference #2", metAddress: "F7", responseAddress: "G7" },
  ],
};

describe("aspectForControl", () => {
  it("maps the standard UCR / PS controls to aspects", () => {
    expect(aspectForControl("UCR-001", "About the Customer")).toBe("aboutCustomer");
    expect(aspectForControl("UCR-002", "Key Business Challenge")).toBe("challenge");
    expect(aspectForControl("UCR-003", "Goals / Objectives")).toBe("goals");
    expect(aspectForControl("PS-001", "Technical Solution")).toBe("solution");
    expect(aspectForControl("OUT-001", "Outcomes and results")).toBe("outcomes");
  });
  it("returns null for controls that aren't a narrative aspect", () => {
    expect(aspectForControl("UCR-004", "Designation Definition Fit")).toBeNull();
  });
});

describe("isCustomerExampleControl", () => {
  it("is true only when targets carry a refLabel", () => {
    expect(isCustomerExampleControl(ucr1)).toBe(true);
    expect(
      isCustomerExampleControl({
        sheetName: "Practice",
        controlId: "GEN-001",
        requirement: "x",
        responseTargets: [{ metAddress: "C5", responseAddress: "D5" }],
      }),
    ).toBe(false);
  });
});

describe("buildCustomerExampleFills", () => {
  it("fills each reference column from the ordered case studies (+ Yes)", () => {
    const fills = buildCustomerExampleFills([ucr1], [cs({ aboutCustomer: "Acme uni." }), cs({ aboutCustomer: "Globex." })]);
    expect(fills).toEqual([
      { sheet: "Common Cust Example Reqs", cellAddress: "E7", value: "Acme uni." },
      { sheet: "Common Cust Example Reqs", cellAddress: "D7", value: "Yes" },
      { sheet: "Common Cust Example Reqs", cellAddress: "G7", value: "Globex." },
      { sheet: "Common Cust Example Reqs", cellAddress: "F7", value: "Yes" },
    ]);
  });
  it("caps at min(reference columns, case studies)", () => {
    // 2 reference columns, 1 case study -> only reference #1 is filled.
    const fills = buildCustomerExampleFills([ucr1], [cs()]);
    expect(fills).toHaveLength(2);
    expect(fills[0]!.cellAddress).toBe("E7");
  });
  it("skips practice controls and unmapped controls", () => {
    const practice: ControlForFill = {
      sheetName: "Practice",
      controlId: "GEN-001",
      requirement: "Security CI/CD",
      responseTargets: [{ metAddress: "C5", responseAddress: "D5" }],
    };
    const unmapped: ControlForFill = { ...ucr1, controlId: "UCR-004", requirement: "Designation Definition Fit" };
    expect(buildCustomerExampleFills([practice, unmapped], [cs()])).toHaveLength(0);
  });
  it("skips empty aspect values", () => {
    const fills = buildCustomerExampleFills([ucr1], [cs({ aboutCustomer: "   " })]);
    expect(fills).toHaveLength(0);
  });
});
