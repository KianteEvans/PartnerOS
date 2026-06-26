import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Bulk task/evidence updates through the gate: one batch = one RLS-scoped UPDATE,
 * with owner validation, the empty-selection guard, and (critically) tenant
 * isolation — a forged cross-tenant id is simply not matched, never updated.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let taskOps: typeof import("@/domain/tasks/operations");
let evOps: typeof import("@/domain/evidence/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let memberA = "";
let ownerB = "";

function identity(tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role: "owner" as const,
  };
}

function runAs<T>(
  id: ReturnType<typeof identity>,
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "bulk.test", resourceType: "task", handler },
    { resolveIdentity: async () => id },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  taskOps = await import("@/domain/tasks/operations");
  evOps = await import("@/domain/evidence/operations");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const inserted = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "member-a", email: "member@acme.test", role: "member" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    memberA = inserted.find((u) => u.sub === "member-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

async function makeTasks(id: ReturnType<typeof identity>, n: number, keyPrefix: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await runAs(id, "task:create", `${keyPrefix}-${i}`, (ctx) =>
      taskOps.createTaskOp(ctx, { title: `T${i}`, description: "", priority: "low", ownerUserId: null, dueDate: null }),
    );
    ids.push((r.body as { id: string }).id);
  }
  return ids;
}

describe("bulk actions", () => {
  it("sets priority on many tasks in one batch", async () => {
    const ids = await makeTasks(identity(tenantA, ownerA), 3, "mk");
    const r = await runAs(identity(tenantA, ownerA), "task:update", "bulk-prio", (ctx) =>
      taskOps.bulkUpdateTasksOp(ctx, { ids, priority: "high" }),
    );
    expect((r.body as { count: number }).count).toBe(3);

    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const rows = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select({ priority: tasks.priority }).from(tasks).where(inArray(tasks.id, ids)),
    );
    expect(rows.every((t) => t.priority === "high")).toBe(true);
  });

  it("bulk-completes tasks (status done)", async () => {
    const ids = await makeTasks(identity(tenantA, ownerA), 2, "mk-done");
    await runAs(identity(tenantA, ownerA), "task:update", "bulk-done", (ctx) =>
      taskOps.bulkUpdateTasksOp(ctx, { ids, complete: true }),
    );
    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const rows = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select({ status: tasks.status }).from(tasks).where(inArray(tasks.id, ids)),
    );
    expect(rows.every((t) => t.status === "done")).toBe(true);
  });

  it("bulk owner assign validates membership", async () => {
    const ids = await makeTasks(identity(tenantA, ownerA), 1, "mk-own");
    await runAs(identity(tenantA, ownerA), "task:update", "bulk-own-ok", (ctx) =>
      taskOps.bulkUpdateTasksOp(ctx, { ids, ownerUserId: memberA }),
    );
    // A non-member id is rejected.
    await expect(
      runAs(identity(tenantA, ownerA), "task:update", "bulk-own-bad", (ctx) =>
        taskOps.bulkUpdateTasksOp(ctx, { ids, ownerUserId: ownerB }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects an empty selection", async () => {
    await expect(
      runAs(identity(tenantA, ownerA), "task:update", "bulk-empty", (ctx) =>
        taskOps.bulkUpdateTasksOp(ctx, { ids: [], priority: "low" }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("never touches another tenant's rows", async () => {
    const bIds = await makeTasks(identity(tenantB, ownerB), 1, "mk-b");
    // Tenant A attempts to bulk-update tenant B's task id.
    const r = await runAs(identity(tenantA, ownerA), "task:update", "bulk-cross", (ctx) =>
      taskOps.bulkUpdateTasksOp(ctx, { ids: bIds, priority: "critical" }),
    );
    expect((r.body as { count: number }).count).toBe(0);
    // B's task is untouched.
    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const [b] = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select({ priority: tasks.priority }).from(tasks).where(eq(tasks.id, bIds[0]!)),
    );
    expect(b!.priority).toBe("low");
  });

  it("bulk-updates evidence status", async () => {
    const id = identity(tenantA, ownerA);
    const e1 = await runAs(id, "evidence:create", "ev-1", (ctx) =>
      evOps.createEvidenceOp(ctx, { title: "E1", evidenceType: "other", program: null, ownerUserId: null, dueDate: null, expirationDate: null, reusable: false }),
    );
    const e2 = await runAs(id, "evidence:create", "ev-2", (ctx) =>
      evOps.createEvidenceOp(ctx, { title: "E2", evidenceType: "other", program: null, ownerUserId: null, dueDate: null, expirationDate: null, reusable: false }),
    );
    const ids = [(e1.body as { id: string }).id, (e2.body as { id: string }).id];
    const r = await runAs(id, "evidence:update", "ev-bulk", (ctx) =>
      evOps.bulkUpdateEvidenceOp(ctx, { ids, status: "collected" }),
    );
    expect((r.body as { count: number }).count).toBe(2);

    const { withTenant } = db.client;
    const { evidence } = db.schema;
    const rows = await withTenant(id, (tx) =>
      tx.select({ status: evidence.status }).from(evidence).where(inArray(evidence.id, ids)),
    );
    expect(rows.every((e) => e.status === "collected")).toBe(true);
  });
});
