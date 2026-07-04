import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Live roadmap reconciliation (Wave 2, Slice B). Verifies reconcileMilestonesOp
 * auto-advances the program/tier milestones whose real state is satisfied (active
 * program / met tier requirement), mirrors the linked task to done, leaves custom /
 * unmet ones planned, and is strictly tenant-scoped (RLS + data-driven).
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let roadmapOps: typeof import("@/domain/roadmaps/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let roadmapA = "";
let roadmapB = "";
let taskA = "";

function identity(tenantId: string, userId: string) {
  return { tenantId, userId, oidcSubject: `sub-${userId}`, epoch: 0, email: `${userId}@test`, role: "owner" as const };
}
const idA = () => identity(tenantA, ownerA);
const idB = () => identity(tenantB, ownerB);

async function run<T>(permission: Permission, key: string, handler: (ctx: MutationContext) => Promise<T>, who = idA) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "roadmap.reconcile.test", resourceType: "roadmap", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  roadmapOps = await import("@/domain/roadmaps/operations");

  const { withSystem } = db.client;
  const { tenants, users, programs, tierPlans, tierRequirements, roadmaps, roadmapMilestones, tasks } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const us = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "own-a", email: "a@a.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "own-b", email: "b@b.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = us.find((u) => u.sub === "own-a")!.id;
    ownerB = us.find((u) => u.sub === "own-b")!.id;

    // Tenant A: an ACTIVE competency + a MET tier requirement.
    await tx.insert(programs).values({
      tenantId: tenantA, libraryKey: "migration_competency", name: "Migration Competency",
      programType: "Competency", deliveryModel: "Consulting", fundingFit: "high", status: "active", createdBy: ownerA,
    });
    const [plan] = await tx
      .insert(tierPlans)
      .values({ tenantId: tenantA, currentTier: "select", targetTier: "advanced", catalogVersion: 2, createdBy: ownerA })
      .returning({ id: tierPlans.id });
    await tx.insert(tierRequirements).values({
      tenantId: tenantA, planId: plan!.id, requirementKey: "launched_count", label: "Launched opportunities",
      category: "opportunities", unit: "launched", threshold: 1, currentValue: 2, kind: "count", // 2 >= 1 -> met
    });

    // A task linked to the program milestone -> should mirror to done on advance.
    const [tk] = await tx
      .insert(tasks)
      .values({ tenantId: tenantA, title: "Submit Migration Competency", status: "open", createdBy: ownerA })
      .returning({ id: tasks.id });
    taskA = tk!.id;

    const [ra] = await tx
      .insert(roadmaps)
      .values({ tenantId: tenantA, name: "Path to Advanced", status: "finalized", startDate: "2026-01-01", createdBy: ownerA })
      .returning({ id: roadmaps.id });
    roadmapA = ra!.id;
    await tx.insert(roadmapMilestones).values([
      { tenantId: tenantA, roadmapId: roadmapA, sequence: 1, title: "Earn Migration Competency", targetDate: "2026-06-01", originKind: "program", originRef: "migration_competency", status: "planned", taskId: taskA },
      { tenantId: tenantA, roadmapId: roadmapA, sequence: 2, title: "Advanced: launched", targetDate: "2026-07-01", originKind: "tier", originRef: "advanced:launched_count", status: "planned" },
      { tenantId: tenantA, roadmapId: roadmapA, sequence: 3, title: "Write a blog", targetDate: "2026-08-01", originKind: "custom", originRef: "", status: "planned" },
    ]);

    // Tenant B: same-shaped roadmap but NO active program -> nothing to advance.
    const [rb] = await tx
      .insert(roadmaps)
      .values({ tenantId: tenantB, name: "B roadmap", status: "finalized", startDate: "2026-01-01", createdBy: ownerB })
      .returning({ id: roadmaps.id });
    roadmapB = rb!.id;
    await tx.insert(roadmapMilestones).values({
      tenantId: tenantB, roadmapId: roadmapB, sequence: 1, title: "Earn Migration Competency", targetDate: "2026-06-01", originKind: "program", originRef: "migration_competency", status: "planned",
    });
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

async function statusByOrigin(roadmapId: string): Promise<Record<string, string>> {
  const rows = await db.client.withSystem((tx) =>
    tx
      .select({ originKind: db.schema.roadmapMilestones.originKind, status: db.schema.roadmapMilestones.status })
      .from(db.schema.roadmapMilestones)
      .where(eq(db.schema.roadmapMilestones.roadmapId, roadmapId)),
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.originKind] = r.status;
  return out;
}

describe("roadmap reconciliation", () => {
  it("auto-advances satisfied program + tier milestones and mirrors the linked task", async () => {
    const res = await run("roadmap:update", "reconcile-a", (ctx) => roadmapOps.reconcileMilestonesOp(ctx, { roadmapId: roadmapA }));
    expect(res.body.advanced.map((a) => a.reason).sort()).toEqual(["Program active", "Requirement met"]);

    const byOrigin = await statusByOrigin(roadmapA);
    expect(byOrigin.program).toBe("done");
    expect(byOrigin.tier).toBe("done");
    expect(byOrigin.custom).toBe("planned"); // never auto-advanced

    // The linked task mirrored to done.
    const [tk] = await db.client.withSystem((tx) =>
      tx.select({ status: db.schema.tasks.status }).from(db.schema.tasks).where(eq(db.schema.tasks.id, taskA)),
    );
    expect(tk!.status).toBe("done");
  });

  it("is data-driven per tenant: B has no active program, so nothing advances", async () => {
    const res = await run("roadmap:update", "reconcile-b", (ctx) => roadmapOps.reconcileMilestonesOp(ctx, { roadmapId: roadmapB }), idB);
    expect(res.body.advanced).toHaveLength(0);
    const byOrigin = await statusByOrigin(roadmapB);
    expect(byOrigin.program).toBe("planned");
  });

  it("is idempotent — a second run advances nothing new", async () => {
    const res = await run("roadmap:update", "reconcile-a-2", (ctx) => roadmapOps.reconcileMilestonesOp(ctx, { roadmapId: roadmapA }));
    expect(res.body.advanced).toHaveLength(0); // already done
  });
});
