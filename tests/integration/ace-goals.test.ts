import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";
import type { GoalData, GoalOpp } from "@/domain/ace-goals/catalog";

/**
 * Co-Selling Goals end-to-end through the gate: create/update/archive + RLS, the
 * catalog measuring real DB rows (revenue + AWS-originated counts), and the
 * materialize-on-read snapshot series (same-day idempotency).
 */

const TODAY = "2026-06-29";
const START = "2026-04-01";

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/ace-goals/operations");
let goalLoad: typeof import("@/domain/ace-goals/load");
let catalog: typeof import("@/domain/ace-goals/catalog");

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
    { permission, idempotencyKey: key, rawBody: "{}", action: "ace_goal.test", resourceType: "ace_goal", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/ace-goals/operations");
  goalLoad = await import("@/domain/ace-goals/load");
  catalog = await import("@/domain/ace-goals/catalog");

  const { withSystem } = db.client;
  const { tenants, users, opportunities, aceRelationships } = db.schema;
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

    // Pipeline for tenant A: 2 won-in-window ($120k + $80k), 1 won-before-window,
    // and 2 amazon-originated opps created in-window (one also pre-window).
    await tx.insert(opportunities).values([
      { tenantId: tenantA, name: "Won big", accountName: "Acme", stage: "launched", status: "won", amount: 120_000, source: "amazon_originated", closeDate: "2026-05-01", createdAt: new Date("2026-04-15T00:00:00Z"), createdBy: ownerA },
      { tenantId: tenantA, name: "Won small", accountName: "Acme", stage: "launched", status: "won", amount: 80_000, source: "partner_originated", closeDate: "2026-04-10", createdAt: new Date("2026-04-05T00:00:00Z"), createdBy: ownerA },
      { tenantId: tenantA, name: "Won old", accountName: "Acme", stage: "launched", status: "won", amount: 999_000, source: "partner_originated", closeDate: "2026-02-01", createdAt: new Date("2026-01-01T00:00:00Z"), createdBy: ownerA },
      { tenantId: tenantA, name: "AWS new", accountName: "Acme", stage: "qualified", status: "open", amount: 40_000, source: "amazon_originated", closeDate: null, createdAt: new Date("2026-05-20T00:00:00Z"), createdBy: ownerA },
      { tenantId: tenantA, name: "AWS old", accountName: "Acme", stage: "qualified", status: "open", amount: 20_000, source: "amazon_originated", closeDate: null, createdAt: new Date("2026-02-20T00:00:00Z"), createdBy: ownerA },
    ]);
    // Two relationships created in-window, one before.
    await tx.insert(aceRelationships).values([
      { tenantId: tenantA, name: "Rep A", role: "seller", createdAt: new Date("2026-04-02T00:00:00Z"), createdBy: ownerA },
      { tenantId: tenantA, name: "Rep B", role: "solutions_architect", createdAt: new Date("2026-06-01T00:00:00Z"), createdBy: ownerA },
      { tenantId: tenantA, name: "Rep old", role: "seller", createdAt: new Date("2026-01-10T00:00:00Z"), createdBy: ownerA },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

let revenueGoalId = "";

describe("co-selling goals", () => {
  it("creates a goal through the gate", async () => {
    const res = await run("ace_goal:create", "goal-create", (ctx) =>
      ops.createAceGoalOp(ctx, {
        metricKey: "total_revenue",
        targetValue: 500_000,
        periodStart: START,
        targetDeadline: "2026-12-31",
      }),
    );
    revenueGoalId = res.body.id;
    expect(revenueGoalId).toBeTruthy();

    const { withTenant } = db.client;
    const { aceGoals } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(aceGoals).where(eq(aceGoals.id, revenueGoalId)),
    );
    expect(row!.metricKey).toBe("total_revenue");
    expect(row!.targetValue).toBe(500_000);
    expect(row!.status).toBe("active");
  });

  it("updates a goal's target and archives it via status", async () => {
    await run("ace_goal:update", "goal-update", (ctx) =>
      ops.updateAceGoalOp(ctx, { goalId: revenueGoalId, targetValue: 750_000 }),
    );
    await run("ace_goal:update", "goal-archive", (ctx) =>
      ops.updateAceGoalOp(ctx, { goalId: revenueGoalId, status: "archived" }),
    );

    const { withTenant } = db.client;
    const { aceGoals } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(aceGoals).where(eq(aceGoals.id, revenueGoalId)),
    );
    expect(row!.targetValue).toBe(750_000);
    expect(row!.status).toBe("archived");
  });

  it("measures the catalog against real DB rows", async () => {
    const { withTenant } = db.client;
    const { opportunities, aceRelationships } = db.schema;
    const data: GoalData = await withTenant(idA(), async (tx) => {
      const opps = await tx.select().from(opportunities).where(eq(opportunities.tenantId, tenantA));
      const rels = await tx.select().from(aceRelationships).where(eq(aceRelationships.tenantId, tenantA));
      return {
        opps: opps.map((o) => ({ ...o, createdAt: o.createdAt.toISOString().slice(0, 10) })) as GoalOpp[],
        rels: rels.map((r) => ({ createdAt: r.createdAt.toISOString().slice(0, 10) })),
        today: TODAY,
      };
    });

    // Won-in-window revenue: 120k + 80k (the 999k closed before the window is excluded).
    expect(catalog.measureGoal({ metricKey: "total_revenue", periodStart: START }, data)).toBe(200_000);
    // AWS-originated created in window: "Won big" (4-15) + "AWS new" (5-20); "AWS old" (2-20) is out.
    expect(catalog.measureGoal({ metricKey: "net_new_aws_originated_opps", periodStart: START }, data)).toBe(2);
    // Relationships created in window: Rep A + Rep B.
    expect(catalog.measureGoal({ metricKey: "net_new_relationships", periodStart: START }, data)).toBe(2);
  });

  it("captures a daily snapshot series and is idempotent per day", async () => {
    const g = revenueGoalId;
    const s1 = await goalLoad.syncGoalSnapshots(idA(), new Map([[g, 100_000]]), "2026-06-20");
    expect(s1.get(g)).toEqual([100_000]);
    const s2 = await goalLoad.syncGoalSnapshots(idA(), new Map([[g, 150_000]]), "2026-06-21");
    expect(s2.get(g)).toEqual([100_000, 150_000]);
    // Same day again -> overwrite, no duplicate point.
    const s3 = await goalLoad.syncGoalSnapshots(idA(), new Map([[g, 999_000]]), "2026-06-21");
    expect(s3.get(g)).toEqual([100_000, 999_000]);
  });

  it("isolates tenants (RLS)", async () => {
    const { withTenant } = db.client;
    const { aceGoals, aceGoalSnapshots } = db.schema;
    const bGoals = await withTenant(idB(), (tx) =>
      tx.select().from(aceGoals).where(eq(aceGoals.tenantId, tenantB)),
    );
    expect(bGoals).toHaveLength(0);

    // Tenant B cannot see or update tenant A's goal -> not found.
    await expect(
      run("ace_goal:update", "goal-update-cross", (ctx) =>
        ops.updateAceGoalOp(ctx, { goalId: revenueGoalId, targetValue: 1 }), idB),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    // A's snapshot rows are invisible to B even by goal id.
    const bSnaps = await withTenant(idB(), (tx) =>
      tx.select().from(aceGoalSnapshots).where(eq(aceGoalSnapshots.goalId, revenueGoalId)),
    );
    expect(bSnaps).toHaveLength(0);
  });
});
