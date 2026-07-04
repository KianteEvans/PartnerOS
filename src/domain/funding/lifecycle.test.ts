import { describe, it, expect } from "vitest";
import { allowedNext, canTransition, isOpen, lifecycleSteps } from "@/domain/funding/lifecycle";

describe("funding lifecycle", () => {
  it("allows the expected transitions", () => {
    expect(allowedNext("draft")).toEqual(["submitted", "withdrawn"]);
    expect(canTransition("submitted", "approved")).toBe(true);
    expect(canTransition("in_review", "rejected")).toBe(true);
    expect(canTransition("approved", "funded")).toBe(true);
    expect(canTransition("draft", "funded")).toBe(false);
    expect(canTransition("rejected", "approved")).toBe(false);
    expect(allowedNext("funded")).toEqual([]);
  });

  it("isOpen is false only for terminal outcomes", () => {
    for (const s of ["draft", "submitted", "in_review", "approved"] as const) expect(isOpen(s)).toBe(true);
    for (const s of ["rejected", "funded", "withdrawn"] as const) expect(isOpen(s)).toBe(false);
  });

  it("stepper marks progress along the happy path", () => {
    const steps = lifecycleSteps("in_review");
    expect(steps.map((s) => s.key)).toEqual(["draft", "submitted", "in_review", "approved", "funded"]);
    expect(steps.find((s) => s.key === "draft")?.state).toBe("done");
    expect(steps.find((s) => s.key === "in_review")?.state).toBe("current");
    expect(steps.find((s) => s.key === "funded")?.state).toBe("upcoming");
  });

  it("rejected + withdrawn short-circuit to a terminal chip", () => {
    const rej = lifecycleSteps("rejected");
    expect(rej[rej.length - 1]).toMatchObject({ key: "rejected", state: "terminal" });
    const wd = lifecycleSteps("withdrawn");
    expect(wd[wd.length - 1]).toMatchObject({ key: "withdrawn", state: "terminal" });
  });
});
