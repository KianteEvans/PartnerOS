import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Decision snooze (decision_dismissals) through the gate: upsert semantics,
 * the dismissed_until >= today expiry predicate, RLS isolation, and the
 * viewer role being denied notification:dismiss.
 */

const TODAY = "2026-07-03";

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/notifications/operations");
let commandLoad: typeof import("@/domain/command/load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";

function identity(tenantId: string, userId: string, role = "owner") {
  return {
    tenantId,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role: role as "owner" | "admin" | "manager" | "member" | "viewer",
  };
}
const idA = () => identity(tenantA, ownerA);
const idB = () => identity(tenantB, ownerB);

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "notification.dismiss", resourceType: "decision", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/notifications/operations");
  commandLoad = await import("@/domain/command/load");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const ins = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = ins.find((u) => u.sub === "owner-a")!.id;
    ownerB = ins.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("decision dismissals", () => {
  it("snoozes a decision and upserts on re-snooze (one row per decision id)", async () => {
    const first = await run("notification:dismiss", "dis-1", (ctx) =>
      ops.dismissDecisionOp(ctx, { decisionId: "task-overdue-x", until: "2026-07-10" }),
    );
    const again = await run("notification:dismiss", "dis-2", (ctx) =>
      ops.dismissDecisionOp(ctx, { decisionId: "task-overdue-x", until: "2026-07-20" }),
    );
    expect(again.body.id).toBe(first.body.id);

    const { withSystem } = db.client;
    const { decisionDismissals } = db.schema;
    const rows = await withSystem((tx) =>
      tx
        .select({ until: decisionDismissals.dismissedUntil })
        .from(decisionDismissals)
        .where(and(eq(decisionDismissals.tenantId, tenantA), eq(decisionDismissals.decisionId, "task-overdue-x"))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.until).toBe("2026-07-20");

    const active = await commandLoad.loadActiveDismissedIds(idA(), TODAY);
    expect(active.has("task-overdue-x")).toBe(true);
  });

  it("expires: a past-dated snooze is not active", async () => {
    await run("notification:dismiss", "dis-past", (ctx) =>
      ops.dismissDecisionOp(ctx, { decisionId: "mdf-deadline-y", until: "2026-06-30" }),
    );
    const active = await commandLoad.loadActiveDismissedIds(idA(), TODAY);
    expect(active.has("mdf-deadline-y")).toBe(false);
    // Boundary: until === today is still active (>=).
    await run("notification:dismiss", "dis-edge", (ctx) =>
      ops.dismissDecisionOp(ctx, { decisionId: "renewal-z", until: TODAY }),
    );
    const edge = await commandLoad.loadActiveDismissedIds(idA(), TODAY);
    expect(edge.has("renewal-z")).toBe(true);
  });

  it("isolates tenants (RLS)", async () => {
    const activeB = await commandLoad.loadActiveDismissedIds(idB(), TODAY);
    expect(activeB.size).toBe(0);
  });

  it("denies viewers notification:dismiss", async () => {
    await expect(
      run(
        "notification:dismiss",
        "dis-viewer",
        (ctx) => ops.dismissDecisionOp(ctx, { decisionId: "task-overdue-v", until: "2026-07-10" }),
        () => identity(tenantA, ownerA, "viewer"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });
});
