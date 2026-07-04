import { describe, it, expect } from "vitest";
import {
  reconcileOpportunities,
  driftCount,
  reconcileSummary,
  type ReconcileLocalOpp,
  type ReconcileMirrorOpp,
} from "@/domain/aws/reconcile";

const local = (over: Partial<ReconcileLocalOpp> & { id: string }): ReconcileLocalOpp => ({
  externalId: null,
  name: "Deal",
  accountName: "Acct",
  stage: "qualified",
  status: "open",
  amount: 1000,
  ...over,
});
const mirror = (over: Partial<ReconcileMirrorOpp> & { externalId: string }): ReconcileMirrorOpp => ({
  name: "Deal",
  accountName: "Acct",
  stage: "qualified",
  status: "open",
  amount: 1000,
  ...over,
});

describe("reconcileOpportunities", () => {
  it("classifies a matching pair as in_sync (no drift fields)", () => {
    const rows = reconcileOpportunities([local({ id: "o1", externalId: "PC-1" })], [mirror({ externalId: "PC-1" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe("in_sync");
    expect(rows[0]!.driftFields).toEqual([]);
  });

  it("classifies stage/amount differences as drift with exact driftFields", () => {
    const rows = reconcileOpportunities(
      [local({ id: "o1", externalId: "PC-1", stage: "qualified", amount: 1000 })],
      [mirror({ externalId: "PC-1", stage: "business_validation", amount: 5000 })],
    );
    const r = rows[0]!;
    expect(r.classification).toBe("drift");
    expect(r.driftFields).toEqual(["stage", "amount"]);
    expect(r.fields.stage).toEqual({ local: "qualified", mirror: "business_validation", changed: true });
    expect(r.fields.status.changed).toBe(false);
    expect(r.localId).toBe("o1");
  });

  it("classifies a mirror row with no local opp as mirror_only", () => {
    const rows = reconcileOpportunities([], [mirror({ externalId: "PC-9" })]);
    expect(rows[0]!.classification).toBe("mirror_only");
    expect(rows[0]!.localId).toBeNull();
  });

  it("classifies an AWS-linked local opp with no mirror as local_only", () => {
    const rows = reconcileOpportunities([local({ id: "o1", externalId: "PC-1" })], []);
    expect(rows[0]!.classification).toBe("local_only");
    expect(rows[0]!.localId).toBe("o1");
  });

  it("ignores manual opps (null externalId)", () => {
    const rows = reconcileOpportunities([local({ id: "manual" })], [mirror({ externalId: "PC-1" })]);
    // the manual local opp is excluded; only the mirror_only row remains
    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalId).toBe("PC-1");
    expect(rows[0]!.classification).toBe("mirror_only");
  });

  it("sorts drift first, then by externalId", () => {
    const rows = reconcileOpportunities(
      [
        local({ id: "a", externalId: "PC-2" }), // in_sync
        local({ id: "b", externalId: "PC-3", stage: "committed" }), // drift
      ],
      [mirror({ externalId: "PC-2" }), mirror({ externalId: "PC-3", stage: "launched" })],
    );
    expect(rows[0]!.classification).toBe("drift");
    expect(rows.map((r) => r.externalId)).toEqual(["PC-3", "PC-2"]);
  });
});

describe("driftCount + reconcileSummary", () => {
  it("counts drift and rolls up per class", () => {
    const rows = reconcileOpportunities(
      [
        local({ id: "a", externalId: "PC-1" }), // in_sync
        local({ id: "b", externalId: "PC-2", amount: 999 }), // drift
        local({ id: "c", externalId: "PC-3" }), // local_only
      ],
      [mirror({ externalId: "PC-1" }), mirror({ externalId: "PC-2", amount: 5 }), mirror({ externalId: "PC-8" })],
    );
    expect(driftCount(rows)).toBe(1);
    expect(reconcileSummary(rows)).toEqual({ inSync: 1, drift: 1, localOnly: 1, mirrorOnly: 1 });
  });
});
