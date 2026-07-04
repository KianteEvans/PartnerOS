import { describe, it, expect } from "vitest";
import { initialStatusFor, isRunOpen, canApprove, canDismiss } from "./lifecycle";

describe("playbook run lifecycle", () => {
  it("derives the initial status from the verdict", () => {
    expect(initialStatusFor("approval")).toBe("pending_approval");
    expect(initialStatusFor("recommend")).toBe("recommended");
    expect(initialStatusFor("auto")).toBe("executed");
  });

  it("classifies open vs terminal states", () => {
    expect(isRunOpen("recommended")).toBe(true);
    expect(isRunOpen("pending_approval")).toBe(true);
    expect(isRunOpen("executed")).toBe(false);
    expect(isRunOpen("failed")).toBe(false);
    expect(isRunOpen("dismissed")).toBe(false);
  });

  it("only lets a pending run be approved, and only open runs be dismissed", () => {
    expect(canApprove("pending_approval")).toBe(true);
    expect(canApprove("recommended")).toBe(false);
    expect(canApprove("executed")).toBe(false);
    expect(canDismiss("recommended")).toBe(true);
    expect(canDismiss("pending_approval")).toBe(true);
    expect(canDismiss("executed")).toBe(false);
  });
});
