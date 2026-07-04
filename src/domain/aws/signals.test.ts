import { describe, it, expect } from "vitest";
import { awsSyncDecisions } from "@/domain/aws/signals";

const TODAY = "2026-06-30"; // connectorHealth window is 7 days -> stale before 2026-06-23

describe("awsSyncDecisions", () => {
  it("returns nothing for undefined input", () => {
    expect(awsSyncDecisions(undefined, TODAY)).toEqual([]);
  });

  it("flags a stale sync when configured and never synced", () => {
    const d = awsSyncDecisions({ status: "configured", lastSyncDate: null, driftCount: 0 }, TODAY);
    expect(d).toHaveLength(1);
    expect(d[0]!.id).toBe("aws-sync-stale");
    expect(d[0]!.situation).toBe("aws_sync_stale");
    expect(d[0]!.link).toBe("/ace?tab=reconcile");
  });

  it("flags a stale sync when the last sync is older than the window", () => {
    const d = awsSyncDecisions({ status: "configured", lastSyncDate: "2026-06-01", driftCount: 0 }, TODAY);
    expect(d.some((x) => x.id === "aws-sync-stale")).toBe(true);
  });

  it("stays quiet for a fresh sync", () => {
    const d = awsSyncDecisions({ status: "configured", lastSyncDate: "2026-06-28", driftCount: 0 }, TODAY);
    expect(d).toEqual([]);
  });

  it("does not nag when the connection is disabled / errored / unconfigured", () => {
    for (const status of ["disabled", "error", "not_configured"]) {
      expect(awsSyncDecisions({ status, lastSyncDate: null, driftCount: 0 }, TODAY)).toEqual([]);
    }
  });

  it("flags drift with a count and a reconcile link", () => {
    const d = awsSyncDecisions({ status: "configured", lastSyncDate: "2026-06-28", driftCount: 3 }, TODAY);
    const drift = d.find((x) => x.id === "aws-sync-drift")!;
    expect(drift.situation).toBe("aws_sync_drift");
    expect(drift.detail).toContain("3");
    expect(drift.link).toBe("/ace?tab=reconcile");
  });

  it("can emit both stale and drift together", () => {
    const d = awsSyncDecisions({ status: "configured", lastSyncDate: null, driftCount: 2 }, TODAY);
    expect(d.map((x) => x.id).sort()).toEqual(["aws-sync-drift", "aws-sync-stale"]);
  });
});
