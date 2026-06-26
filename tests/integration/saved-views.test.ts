import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";

/**
 * Saved views end-to-end through the gate: create/upsert/delete, plus the part
 * that matters most — RLS scopes presets to the OWNING user, so a teammate in
 * the same tenant can neither read nor delete another's views.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/views/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
let userA = "";
let userB = "";

function identity(userId: string) {
  return {
    tenantId: tenantA,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role: "member" as const,
  };
}

async function runAs<T>(
  userId: string,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
) {
  return gate.runMutation(
    { permission: "view:manage", idempotencyKey: key, rawBody: "{}", action: "view.test", resourceType: "saved_view", handler },
    { resolveIdentity: async () => identity(userId) },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/views/operations");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values({ id: tenantA, name: "Acme", slug: "acme" });
    const inserted = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "user-a", email: "a@acme.test", role: "member" },
        { tenantId: tenantA, oidcSubject: "user-b", email: "b@acme.test", role: "member" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    userA = inserted.find((u) => u.sub === "user-a")!.id;
    userB = inserted.find((u) => u.sub === "user-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("saved views", () => {
  it("saves a view scoped to the creating user", async () => {
    await runAs(userA, "sv-1", (ctx) =>
      ops.saveViewOp(ctx, { listKey: "tasks", name: "My overdue", query: "view=overdue" }),
    );
    const { withTenant } = db.client;
    const { savedViews } = db.schema;
    const rows = await withTenant(identity(userA), (tx) =>
      tx.select().from(savedViews).where(eq(savedViews.listKey, "tasks")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("My overdue");
    expect(rows[0]!.query).toBe("view=overdue");
    expect(rows[0]!.userId).toBe(userA);
  });

  it("re-saving the same name overwrites the query (no duplicate)", async () => {
    await runAs(userA, "sv-2", (ctx) =>
      ops.saveViewOp(ctx, { listKey: "tasks", name: "My overdue", query: "view=overdue&q=acme" }),
    );
    const { withTenant } = db.client;
    const { savedViews } = db.schema;
    const rows = await withTenant(identity(userA), (tx) =>
      tx.select().from(savedViews).where(and(eq(savedViews.listKey, "tasks"), eq(savedViews.name, "My overdue"))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.query).toBe("view=overdue&q=acme");
  });

  it("rejects an unknown list key", async () => {
    await expect(
      runAs(userA, "sv-bad", (ctx) =>
        ops.saveViewOp(ctx, { listKey: "not-a-list", name: "x", query: "" }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("a different user cannot see another's views (RLS)", async () => {
    const { withTenant } = db.client;
    const { savedViews } = db.schema;
    const rows = await withTenant(identity(userB), (tx) =>
      tx.select().from(savedViews).where(eq(savedViews.listKey, "tasks")),
    );
    expect(rows).toHaveLength(0);
  });

  it("a different user cannot delete another's view (RLS hides the row)", async () => {
    const { withTenant } = db.client;
    const { savedViews } = db.schema;
    const [v] = await withTenant(identity(userA), (tx) =>
      tx.select({ id: savedViews.id }).from(savedViews).where(eq(savedViews.listKey, "tasks")),
    );
    await expect(
      runAs(userB, "sv-del-foreign", (ctx) => ops.deleteViewOp(ctx, { viewId: v!.id })),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    // Still there for the owner.
    const still = await withTenant(identity(userA), (tx) =>
      tx.select().from(savedViews).where(eq(savedViews.id, v!.id)),
    );
    expect(still).toHaveLength(1);
  });

  it("the owner deletes their own view", async () => {
    const { withTenant } = db.client;
    const { savedViews } = db.schema;
    const [v] = await withTenant(identity(userA), (tx) =>
      tx.select({ id: savedViews.id }).from(savedViews).where(eq(savedViews.listKey, "tasks")),
    );
    await runAs(userA, "sv-del", (ctx) => ops.deleteViewOp(ctx, { viewId: v!.id }));
    const rows = await withTenant(identity(userA), (tx) =>
      tx.select().from(savedViews).where(eq(savedViews.listKey, "tasks")),
    );
    expect(rows).toHaveLength(0);
  });

  it("two users can hold same-named views independently", async () => {
    await runAs(userA, "sv-a-shared", (ctx) =>
      ops.saveViewOp(ctx, { listKey: "evidence", name: "Shared", query: "view=missing" }),
    );
    await runAs(userB, "sv-b-shared", (ctx) =>
      ops.saveViewOp(ctx, { listKey: "evidence", name: "Shared", query: "view=rejected" }),
    );
    const { withTenant } = db.client;
    const { savedViews } = db.schema;
    const aRows = await withTenant(identity(userA), (tx) =>
      tx.select().from(savedViews).where(eq(savedViews.listKey, "evidence")),
    );
    const bRows = await withTenant(identity(userB), (tx) =>
      tx.select().from(savedViews).where(eq(savedViews.listKey, "evidence")),
    );
    expect(aRows).toHaveLength(1);
    expect(aRows[0]!.query).toBe("view=missing");
    expect(bRows).toHaveLength(1);
    expect(bRows[0]!.query).toBe("view=rejected");
  });
});
