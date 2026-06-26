import { describe, it, expect } from "vitest";
import {
  CONTROL_ID_RE,
  classifySheet,
  findHeader,
  extractControls,
  detectSheet,
  toMetValue,
  detectProgram,
} from "@/domain/applications/detect";
import type { Grid } from "@/domain/applications/grid";

// A practice-requirement sheet: banner, header, sections, controls.
const PRACTICE: Grid = [
  ["Security Practice Requirements - the following apply ...", "", "", ""],
  ["ID", "Requirement Description", "Met?", "Partner Response"],
  ["Security Practice Overview", "", "", ""],
  ["GEN-001", "Security CI/CD ...", "", ""],
  ["GEN-002", "Infrastructure as Code ...", "", ""],
  ["Identity And Access Management", "", "", ""],
  ["IDAM-001", "CIEM ...", "", ""],
];

// A customer-example sheet: repeating Customer Reference #N groups (C/D, E/F, ...).
const CUST_EXAMPLE: Grid = [
  ["Security Customer Example Requirements ...", "", "", "", "", "", "", "", "", ""],
  ["ID", "Requirement Description", "Customer Reference #1", "", "Customer Reference #2", "", "Customer Reference #3", "", "Customer Reference #4", ""],
  ["", "", "Met?", "Partner Response", "Met?", "Partner Response", "Met?", "Partner Response", "Met?", "Partner Response"],
  ["Customer Examples", "", "", "", "", "", "", "", "", ""],
  ["EXMUC-001", "Security-specific customer examples ...", "", "", "", "", "", "", "", ""],
];

// The Common customer-example sheet has an "Example Response" column (C), so the
// reference groups shift right to D/E, F/G, ...
const COMMON_CUST: Grid = [
  ["Common Customer Example Requirements ...", "", "", "", "", "", "", "", "", "", ""],
  ["ID", "Requirement Description", "Example Response", "Customer Reference #1", "", "Customer Reference #2", "", "Customer Reference #3", "", "Customer Reference #4", ""],
  ["", "", "", "Met?", "Partner Response", "Met?", "Partner Response", "Met?", "Partner Response", "Met?", "Partner Response"],
  ["Use Case Relevance", "", "", "", "", "", "", "", "", "", ""],
  ["UCR-001", "About the Customer ...", "Our customer is a public university system ...", "", "", "", "", "", "", "", ""],
];

const INTRO: Grid = [
  ["AWS Security Competency Service Offering Validation Checklist ...", ""],
  ["AWS Security Competency Definition ...", ""],
];

describe("CONTROL_ID_RE", () => {
  it("matches real control IDs and rejects non-IDs", () => {
    for (const id of ["GEN-001", "IDAM-002", "POV-001", "GENAIPR-003", "EXMUC-001", "UCR-001", "PS-001"]) {
      expect(CONTROL_ID_RE.test(id)).toBe(true);
    }
    expect(CONTROL_ID_RE.test("see GEN-001")).toBe(false);
    expect(CONTROL_ID_RE.test("GEN")).toBe(false);
    expect(CONTROL_ID_RE.test("A-1")).toBe(false); // needs >=2 leading letters
  });
});

describe("classifySheet", () => {
  it("classifies each sheet kind", () => {
    expect(classifySheet(PRACTICE)).toBe("practice");
    expect(classifySheet(CUST_EXAMPLE)).toBe("customer_example");
    expect(classifySheet(COMMON_CUST)).toBe("customer_example");
    expect(classifySheet(INTRO)).toBe("intro");
    expect(classifySheet([["Title", ""], ["GEN-009", "floating control"]])).toBe("unknown");
  });
});

describe("findHeader", () => {
  it("resolves practice columns (header not on row 0)", () => {
    const cm = findHeader(PRACTICE)!;
    expect(cm.headerRow).toBe(1);
    expect(cm.bodyStartRow).toBe(2);
    expect(cm.idCol).toBe(0);
    expect(cm.requirementCol).toBe(1);
    expect(cm.practicePair).toEqual({ metCol: 2, responseCol: 3 });
    expect(cm.referenceGroups).toHaveLength(0);
  });
  it("resolves customer-reference groups + skips the sub-header", () => {
    const cm = findHeader(CUST_EXAMPLE)!;
    expect(cm.bodyStartRow).toBe(3);
    expect(cm.referenceGroups).toHaveLength(4);
    expect(cm.referenceGroups[0]).toEqual({ refLabel: "Customer Reference #1", metCol: 2, responseCol: 3 });
    expect(cm.referenceGroups[1]!.metCol).toBe(4);
  });
  it("detects the Example Response offset and shifts groups right", () => {
    const cm = findHeader(COMMON_CUST)!;
    expect(cm.exampleResponseCol).toBe(2);
    expect(cm.referenceGroups[0]).toEqual({ refLabel: "Customer Reference #1", metCol: 3, responseCol: 4 });
  });
  it("returns null for an intro / headerless sheet", () => {
    expect(findHeader(INTRO)).toBeNull();
  });
});

describe("extractControls", () => {
  it("emits practice controls with section tracking and A1 targets", () => {
    const cm = findHeader(PRACTICE)!;
    const controls = extractControls(PRACTICE, cm, "Security");
    expect(controls).toHaveLength(3);
    expect(controls[0]!.id).toBe("GEN-001");
    expect(controls[0]!.section).toBe("Security Practice Overview");
    expect(controls[0]!.responseTargets[0]!.responseAddress).toBe("D4");
    expect(controls[0]!.responseTargets[0]!.metAddress).toBe("C4");
    expect(controls[2]!.id).toBe("IDAM-001");
    expect(controls[2]!.section).toBe("Identity And Access Management");
    expect(controls[2]!.responseTargets[0]!.responseAddress).toBe("D7");
  });
  it("emits one target per customer reference", () => {
    const cm = findHeader(CUST_EXAMPLE)!;
    const controls = extractControls(CUST_EXAMPLE, cm, "Sec Cust Ex");
    expect(controls).toHaveLength(1);
    expect(controls[0]!.section).toBe("Customer Examples");
    expect(controls[0]!.responseTargets).toHaveLength(4);
    expect(controls[0]!.responseTargets[0]!.refLabel).toBe("Customer Reference #1");
    expect(controls[0]!.responseTargets[0]!.responseAddress).toBe("D5");
    expect(controls[0]!.responseTargets[1]!.metAddress).toBe("E5");
  });
  it("captures the AWS example response and the right-shifted targets", () => {
    const cm = findHeader(COMMON_CUST)!;
    const controls = extractControls(COMMON_CUST, cm, "Common Cust Ex");
    expect(controls[0]!.exampleResponse).toContain("public university");
    expect(controls[0]!.responseTargets[0]!.metAddress).toBe("D5");
    expect(controls[0]!.responseTargets[0]!.responseAddress).toBe("E5");
  });
  it("emits duplicate IDs on separate rows", () => {
    const grid: Grid = [
      ["ID", "Requirement Description", "Met?", "Partner Response"],
      ["GEN-001", "first", "", ""],
      ["GEN-001", "second", "", ""],
    ];
    const cm = findHeader(grid)!;
    const controls = extractControls(grid, cm, "S");
    expect(controls).toHaveLength(2);
    expect(controls[0]!.requirement).toBe("first");
    expect(controls[1]!.requirement).toBe("second");
  });
});

describe("detectSheet", () => {
  it("returns intro for the introduction sheet (no controls)", () => {
    const d = detectSheet(INTRO, "Introduction");
    expect(d.kind).toBe("intro");
    expect(d.controls).toHaveLength(0);
    expect(d.columnMap).toBeNull();
  });
  it("returns a fully detected practice sheet", () => {
    const d = detectSheet(PRACTICE, "Security");
    expect(d.kind).toBe("practice");
    expect(d.controls).toHaveLength(3);
    expect(d.controls.every((c) => c.sheetName === "Security")).toBe(true);
  });
});

describe("toMetValue", () => {
  it("maps to the Yes/No dropdown domain", () => {
    expect(toMetValue(true)).toBe("Yes");
    expect(toMetValue(false)).toBe("No");
    expect(toMetValue("yes")).toBe("Yes");
    expect(toMetValue("Y")).toBe("Yes");
    expect(toMetValue("no")).toBe("No");
    expect(toMetValue("anything")).toBe("No");
  });
});

describe("detectProgram", () => {
  it("identifies each AWS Specialization program type + name from the title", () => {
    expect(detectProgram(["AWS Security Competency Service Offering Validation Checklist"]))
      .toEqual({ programType: "Competency", name: "Security" });
    expect(detectProgram(["AWS Transfer Family Service Delivery Service Delivery Validation"]))
      .toEqual({ programType: "Service Delivery", name: "Transfer Family" });
    expect(detectProgram(["Amazon EKS Service Ready AWS Service Ready Validation Checklist"]))
      .toEqual({ programType: "Service Ready", name: "Amazon EKS" });
    expect(detectProgram(["AWS Managed Service Provider (MSP) Program MSP Validation"]))
      .toEqual({ programType: "MSP", name: "Managed Service Provider" });
    expect(detectProgram(["Foundational Technical Review for Service Offering Service Readiness"]))
      .toEqual({ programType: "FTR", name: "Foundational Technical Review" });
  });
  it("skips blank titles and falls back to Unknown", () => {
    expect(detectProgram(["", "  ", "Just a sheet title"])).toEqual({ programType: "Unknown", name: "" });
    expect(detectProgram([])).toEqual({ programType: "Unknown", name: "" });
  });
  it("returns the first matching title in order", () => {
    expect(detectProgram(["Introduction", "AWS DevOps Competency Validation"]).programType).toBe("Competency");
  });
});
