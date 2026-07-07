import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Per-individual DSAR export (src/domain/dsar/subject-load.ts). Verifies the
 * loader returns only the subject's own data (audit activity, invitations,
 * authored-record references) and NOT another member's, and that the
 * tenant-scoped profile lookup is the authorization boundary — a subject in
 * another tenant is invisible under RLS (null -> the route 404s).
 */

let db: TestDb;
let dsar: typeof import("@/domain/dsar/subject-load");

const T = "11111111-0000-0000-0000-000000000001";
const T2 = "22222222-0000-0000-0000-000000000002";
let userA = "";
let userB = "";
let userOther = "";

const id = (tenantId: string, userId: string) => ({ tenantId, userId, role: "owner" }) as const;

beforeAll(async () => {
  db = await setupTestDb();
  dsar = await import("@/domain/dsar/subject-load");
  const { withSystem } = db.client;
  const { tenants, users, storageObjects, auditLog, invitations } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: T, name: "Acme", slug: "acme" },
      { id: T2, name: "Other", slug: "other" },
    ]);
    const us = await tx
      .insert(users)
      .values([
        { tenantId: T, oidcSubject: "a", email: "alice@acme.test", role: "admin" },
        { tenantId: T, oidcSubject: "b", email: "bob@acme.test", role: "member" },
        { tenantId: T2, oidcSubject: "o", email: "o@other.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    userA = us.find((u) => u.sub === "a")!.id;
    userB = us.find((u) => u.sub === "b")!.id;
    userOther = us.find((u) => u.sub === "o")!.id;

    // storage_objects is a simple table carrying created_by -> exercises the
    // reflection-driven authored-records scan.
    await tx.insert(storageObjects).values([
      { tenantId: T, bucket: "b", objectKey: "a.txt", contentType: "text/plain", sizeBytes: 10, createdBy: userA },
      { tenantId: T, bucket: "b", objectKey: "b.txt", contentType: "text/plain", sizeBytes: 20, createdBy: userB },
    ]);
    await tx.insert(auditLog).values([
      { tenantId: T, actorUserId: userA, action: "test.a", resourceType: "user" },
      { tenantId: T, actorUserId: userB, action: "test.b", resourceType: "user" },
    ]);
    await tx.insert(invitations).values([
      { tenantId: T, email: "alice@acme.test", token: "t-a" },
      { tenantId: T, email: "bob@acme.test", token: "t-b" },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("per-individual DSAR export", () => {
  it("returns only the subject's personal data + authored references", async () => {
    const bundle = await dsar.loadSubjectExport(id(T, userA), userA);
    expect(bundle).not.toBeNull();
    expect(bundle!.subject).toEqual({ userId: userA, email: "alice@acme.test" });
    expect(bundle!.data.auditActivity).toHaveLength(1); // only A's audit row, not B's
    expect(bundle!.data.invitations).toHaveLength(1); // only the invite to A's email
    const storageRefs = bundle!.data.authoredRecords.filter((r) => r.table === "storage_objects");
    expect(storageRefs).toHaveLength(1); // A's object, not B's
    expect(storageRefs[0]!.via).toBe("created_by");
    expect(bundle!.summary).toMatchObject({ auditEvents: 1, invitations: 1 });
  });

  it("returns null for a subject in another tenant (RLS boundary)", async () => {
    const bundle = await dsar.loadSubjectExport(id(T2, userOther), userA);
    expect(bundle).toBeNull();
  });
});
