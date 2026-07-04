import { describe, it, expect } from "vitest";
import {
  actionAppliesTo,
  basePermissionFor,
  capabilityForAction,
  ACTION_CATALOG,
  PLAYBOOK_ACTION_TYPES,
} from "./catalog";

describe("playbook action catalog", () => {
  it("gates each action to the right situations", () => {
    expect(actionAppliesTo("create_task", "overdue_work")).toBe(true);
    expect(actionAppliesTo("notify", "renewal_due")).toBe(true);
    expect(actionAppliesTo("route_opportunity", "aws_review")).toBe(true);
    expect(actionAppliesTo("route_opportunity", "overdue_work")).toBe(false);
    expect(actionAppliesTo("approve_within_cap", "mdf_deadline")).toBe(true);
    expect(actionAppliesTo("approve_within_cap", "funding_deadline")).toBe(true);
    expect(actionAppliesTo("approve_within_cap", "aws_review")).toBe(false);
  });

  it("resolves the base permission a human would need (approval depends on the fund)", () => {
    expect(basePermissionFor("create_task", "overdue_work")).toBe("task:create");
    expect(basePermissionFor("route_opportunity", "aws_review")).toBe("ace:update");
    expect(basePermissionFor("generate_report", "overdue_work")).toBe("report:create");
    expect(basePermissionFor("approve_within_cap", "mdf_deadline")).toBe("mdf:approve");
    expect(basePermissionFor("approve_within_cap", "funding_deadline")).toBe("funding:approve");
  });

  it("maps actions to their risk-bearing capability; notify escalates by channel", () => {
    expect(capabilityForAction("create_task", []).risk).toBe("medium");
    expect(capabilityForAction("approve_within_cap", []).risk).toBe("high");
    expect(capabilityForAction("generate_report", []).risk).toBe("low");
    // notify: in-app is low, but any external channel escalates to high.
    expect(capabilityForAction("notify", ["in_app"]).risk).toBe("low");
    expect(capabilityForAction("notify", ["in_app", "email"]).risk).toBe("high");
    expect(capabilityForAction("notify", ["webhook"]).risk).toBe("high");
  });

  it("every action type has a catalog entry", () => {
    for (const t of PLAYBOOK_ACTION_TYPES) {
      expect(ACTION_CATALOG[t]).toBeTruthy();
    }
  });
});
