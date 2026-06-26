import { describe, it, expect } from "vitest";
import {
  AWS_STATUSES,
  awsStatusLabel,
  isAwsStatusEditable,
  applicationReadiness,
} from "@/domain/applications/packet";

describe("AWS status catalog", () => {
  it("has the 13 AWS application statuses", () => {
    expect(AWS_STATUSES).toHaveLength(13);
  });
  it("labels and editability follow the guide", () => {
    expect(awsStatusLabel("pending_partner_action")).toBe("Pending Partner Action");
    expect(awsStatusLabel("unknown_value")).toBe("unknown_value"); // unknown -> echo
    // Editable: Draft, Submitted, Expired, Pending Partner Action, Resubmitted.
    for (const k of ["draft", "submitted", "expired", "pending_partner_action", "resubmitted"]) {
      expect(isAwsStatusEditable(k)).toBe(true);
    }
    // Not editable: In Review, Technical Validation*, Confirmed, Declined, Marketing Update, Deleted.
    for (const k of ["in_review", "tech_validation_in_process", "confirmed", "declined", "deleted"]) {
      expect(isAwsStatusEditable(k)).toBe(false);
    }
  });
});

describe("applicationReadiness", () => {
  it("marks every trackable item met when the packet is complete", () => {
    const r = applicationReadiness({
      controlCount: 5,
      acceptedCount: 5,
      categories: "Threat Detection and Response",
      pocName: "Jordan",
      pocEmail: "jordan@acme.test",
      caseStudyCount: 2,
      solutionAttached: true,
    });
    expect(r.responsePercent).toBe(100);
    expect(r.metCount).toBe(5);
    expect(r.trackableCount).toBe(5);
    expect(r.items.filter((i) => i.state === "confirm")).toHaveLength(0); // all modeled now (Tiers C/D)
    expect(r.items.find((i) => i.label === "Solution attached")!.state).toBe("met");
  });

  it("flags gaps for an incomplete packet", () => {
    const r = applicationReadiness({
      controlCount: 5,
      acceptedCount: 2,
      categories: "",
      pocName: "",
      pocEmail: "",
      caseStudyCount: 0,
      solutionAttached: false,
    });
    expect(r.responsePercent).toBe(40);
    expect(r.metCount).toBe(0);
    expect(r.items.find((i) => i.label === "Self-assessment responses")!.state).toBe("gap");
    expect(r.items.find((i) => i.label === "Designation categories")!.state).toBe("gap");
  });

  it("requires both POC name and email", () => {
    const r = applicationReadiness({
      controlCount: 1,
      acceptedCount: 1,
      categories: "x",
      pocName: "Jordan",
      pocEmail: "",
      caseStudyCount: 1,
      solutionAttached: true,
    });
    expect(r.items.find((i) => i.label === "Point of contact")!.state).toBe("gap");
  });

  it("flags a gap when no Solution is attached", () => {
    const r = applicationReadiness({
      controlCount: 1,
      acceptedCount: 1,
      categories: "x",
      pocName: "Jordan",
      pocEmail: "jordan@acme.test",
      caseStudyCount: 1,
      solutionAttached: false,
    });
    expect(r.items.find((i) => i.label === "Solution attached")!.state).toBe("gap");
    expect(r.metCount).toBe(4);
    expect(r.trackableCount).toBe(5);
  });

  it("is safe with zero controls", () => {
    const r = applicationReadiness({ controlCount: 0, acceptedCount: 0, categories: "", pocName: "", pocEmail: "", caseStudyCount: 0, solutionAttached: false });
    expect(r.responsePercent).toBe(0);
    expect(r.items.find((i) => i.label === "Self-assessment responses")!.state).toBe("gap");
  });
});
