import { describe, it, expect } from "vitest";
import { AUTHORED_COLUMN_NAMES, buildSubjectExport, isAuthoredColumn } from "./subject";

describe("DSAR subject (pure)", () => {
  it("recognizes authored-by-user columns and excludes the specially-handled ones", () => {
    expect(isAuthoredColumn("created_by")).toBe(true);
    expect(isAuthoredColumn("owner_user_id")).toBe(true);
    expect(isAuthoredColumn("reviewed_by")).toBe(true);
    expect(isAuthoredColumn("decided_by")).toBe(true);
    // handled explicitly by the loader -> deliberately NOT in the authored set
    expect(isAuthoredColumn("actor_user_id")).toBe(false);
    expect(isAuthoredColumn("user_id")).toBe(false);
    expect(isAuthoredColumn("invited_by_user_id")).toBe(false);
    // unrelated columns
    expect(isAuthoredColumn("tenant_id")).toBe(false);
    expect(AUTHORED_COLUMN_NAMES.has("created_by")).toBe(true);
  });

  it("assembles the bundle with an at-a-glance summary of counts", () => {
    const bundle = buildSubjectExport({
      exportedAt: "2026-07-06T00:00:00.000Z",
      workspaceId: "t1",
      subjectId: "u1",
      email: "jane@x.test",
      parts: {
        profile: { id: "u1", email: "jane@x.test" },
        invitations: [{ id: "i1" }],
        auditActivity: [{ id: "a1" }, { id: "a2" }],
        savedViews: [],
        authoredRecords: [
          { table: "tasks", via: "created_by", id: "task1" },
          { table: "assessments", via: "created_by", id: "as1" },
          { table: "tasks", via: "owner_user_id", id: "task2" },
        ],
      },
    });
    expect(bundle.subject).toEqual({ userId: "u1", email: "jane@x.test" });
    expect(bundle.summary).toEqual({ invitations: 1, auditEvents: 2, savedViews: 0, authoredRecords: 3 });
    expect(bundle.data.profile).toEqual({ id: "u1", email: "jane@x.test" });
    expect(bundle.exportedAt).toBe("2026-07-06T00:00:00.000Z");
    expect(bundle.tenantId).toBe("t1");
  });
});
