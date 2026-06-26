import { describe, it, expect } from "vitest";
import { capabilityDecision, capabilityMatrix, CAPABILITIES } from "@/domain/settings/automation";
import { connectorHealth } from "@/domain/settings/connectors";
import { workspaceReadiness } from "@/domain/settings/readiness";

const TODAY = "2026-06-23";

const cap = (risk: "low" | "medium" | "high") => ({ key: "k", label: "L", risk });

describe("automation governance", () => {
  it("blocks everything when off", () => {
    for (const c of CAPABILITIES) expect(capabilityDecision("off", c)).toBe("blocked");
  });

  it("recommend_only only recommends", () => {
    for (const c of CAPABILITIES) expect(capabilityDecision("recommend_only", c)).toBe("recommend");
  });

  it("auto_with_approval automates low risk, gates the rest", () => {
    expect(capabilityDecision("auto_with_approval", cap("low"))).toBe("auto");
    expect(capabilityDecision("auto_with_approval", cap("medium"))).toBe("approval");
    expect(capabilityDecision("auto_with_approval", cap("high"))).toBe("approval");
  });

  it("autonomous still gates high-risk (governance floor)", () => {
    expect(capabilityDecision("autonomous", cap("low"))).toBe("auto");
    expect(capabilityDecision("autonomous", cap("medium"))).toBe("auto");
    expect(capabilityDecision("autonomous", cap("high"))).toBe("approval");
  });

  it("matrix covers every capability", () => {
    expect(capabilityMatrix("autonomous")).toHaveLength(CAPABILITIES.length);
  });
});

describe("connector health", () => {
  it("derives health from status and freshness", () => {
    expect(connectorHealth({ status: "not_configured", lastSyncDate: null }, TODAY)).toBe("unconfigured");
    expect(connectorHealth({ status: "disabled", lastSyncDate: null }, TODAY)).toBe("disabled");
    expect(connectorHealth({ status: "error", lastSyncDate: "2026-06-22" }, TODAY)).toBe("error");
    expect(connectorHealth({ status: "configured", lastSyncDate: null }, TODAY)).toBe("stale");
    expect(connectorHealth({ status: "configured", lastSyncDate: "2026-06-20" }, TODAY)).toBe("healthy");
    expect(connectorHealth({ status: "configured", lastSyncDate: "2026-01-01" }, TODAY)).toBe("stale");
  });
});

describe("workspace readiness", () => {
  it("foundation floor passes; tenant checks reflect config", () => {
    const empty = workspaceReadiness(null, [], TODAY);
    expect(empty.launchReady).toBe(true); // critical foundation checks all pass
    expect(empty.percent).toBeLessThan(100); // tenant checks not yet satisfied

    const configured = workspaceReadiness(
      { displayName: "Acme", automationMode: "recommend_only" },
      [{ status: "configured", lastSyncDate: "2026-06-20" }],
      TODAY,
    );
    expect(configured.percent).toBe(100);
    expect(configured.launchReady).toBe(true);
  });
});
