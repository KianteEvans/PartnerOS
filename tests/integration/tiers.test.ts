import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Partner Tier Management end-to-end through the gate: plan creation seeds the
 * threshold requirements, gap updates, requirement -> task and -> evidence
 * handoffs, and the readiness-gated advancement that updates tenants.tier.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/tiers/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let memberA = "";

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

let planId = "";
let reqs: { id: string; threshold: number }[] = [];

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "tier.test", resourceType: "tier_plan", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/tiers/operations");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme", tier: "select" },
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

describe("partner tier end-to-end", () => {
  it("creates a plan and seeds the target-tier thresholds", async () => {
    const res = await run("tier:create", "create-plan", (ctx) =>
      ops.createTierPlanOp(ctx, { targetTier: "advanced" }),
    );
    planId = res.body.id;
    expect(res.body.requirements).toBe(4); // advanced has 4 thresholds

    const { withTenant } = db.client;
    const { tierPlans, tierRequirements } = db.schema;
    const [plan] = await withTenant(idA(), (tx) => tx.select().from(tierPlans).where(eq(tierPlans.id, planId)));
    expect(plan!.currentTier).toBe("select");
    expect(plan!.targetTier).toBe("advanced");

    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(tierRequirements).where(eq(tierRequirements.planId, planId)),
    );
    reqs = rows.map((r) => ({ id: r.id, threshold: r.threshold }));
    expect(reqs).toHaveLength(4);
  });

  it("rejects a duplicate plan and an invalid (non-upward) target", async () => {
    await expect(
      run("tier:create", "create-dupe", (ctx) => ops.createTierPlanOp(ctx, { targetTier: "premier" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
    await expect(
      run("tier:create", "create-down", (ctx) => ops.createTierPlanOp(ctx, { targetTier: "select" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects plan creation by a viewer", async () => {
    await expect(
      run("tier:create", "create-viewer", (ctx) => ops.createTierPlanOp(ctx, { targetTier: "premier" }), () => identity(tenantA, ownerA, "viewer")),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("updates a requirement value and validates owner tenancy", async () => {
    await run("tier:update", "update-req", (ctx) =>
      ops.updateRequirementOp(ctx, { requirementId: reqs[0]!.id, currentValue: 2, ownerUserId: memberA }),
    );
    const { withTenant } = db.client;
    const { tierRequirements } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(tierRequirements).where(eq(tierRequirements.id, reqs[0]!.id)));
    expect(r!.currentValue).toBe(2);
    expect(r!.ownerUserId).toBe(memberA);

    await expect(
      run("tier:update", "update-badowner", (ctx) => ops.updateRequirementOp(ctx, { requirementId: reqs[0]!.id, ownerUserId: ownerB })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("hands a requirement off to a task and to evidence (idempotent)", async () => {
    const t1 = await run("tier:update", "req-task", (ctx) => ops.createTaskFromTierRequirementOp(ctx, { requirementId: reqs[1]!.id }));
    expect(t1.body.taskId).not.toBeNull();
    const t2 = await run("tier:update", "req-task-2", (ctx) => ops.createTaskFromTierRequirementOp(ctx, { requirementId: reqs[1]!.id }));
    expect(t2.body.taskId).toBeNull();

    const e1 = await run("tier:update", "req-ev", (ctx) => ops.stageEvidenceForTierRequirementOp(ctx, { requirementId: reqs[1]!.id }));
    expect(e1.body.evidenceId).not.toBeNull();

    const { withTenant } = db.client;
    const { tasks, evidence } = db.schema;
    const tierTasks = await withTenant(idA(), (tx) => tx.select().from(tasks).where(eq(tasks.source, "tier")));
    expect(tierTasks).toHaveLength(1);
    const tierEvidence = await withTenant(idA(), (tx) => tx.select().from(evidence).where(eq(evidence.source, "tier")));
    expect(tierEvidence).toHaveLength(1);
    expect(tierEvidence[0]!.evidenceType).toBe("certification"); // aws_certifications -> certification
  });

  it("blocks advancement until every threshold is met, then advances the tenant tier", async () => {
    await expect(
      run("tier:advance", "advance-early", (ctx) => ops.advanceTierOp(ctx, { planId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    // Meet every requirement.
    for (let i = 0; i < reqs.length; i++) {
      await run("tier:update", `meet-${i}`, (ctx) =>
        ops.updateRequirementOp(ctx, { requirementId: reqs[i]!.id, currentValue: reqs[i]!.threshold }),
      );
    }

    const res = await run("tier:advance", `advance-tier:${planId}`, (ctx) => ops.advanceTierOp(ctx, { planId }));
    expect(res.body.tier).toBe("advanced");

    const { withTenant } = db.client;
    const { tierPlans, tenants } = db.schema;
    const [plan] = await withTenant(idA(), (tx) => tx.select().from(tierPlans).where(eq(tierPlans.id, planId)));
    expect(plan!.status).toBe("achieved");
    expect(plan!.achievedAt).not.toBeNull();
    const [tenant] = await withTenant(idA(), (tx) => tx.select().from(tenants).where(eq(tenants.id, tenantA)));
    expect(tenant!.tier).toBe("advanced"); // the capstone effect

    await expect(
      run("tier:advance", "advance-again", (ctx) => ops.advanceTierOp(ctx, { planId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's tier plan", async () => {
    const { withTenant } = db.client;
    const { tierPlans } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(tierPlans));
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging a tier plan into another tenant", async () => {
    const { withTenant } = db.client;
    const { tierPlans } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(tierPlans).values({
          tenantId: tenantA,
          currentTier: "select",
          targetTier: "advanced",
          catalogVersion: 1,
        }),
      ),
    ).rejects.toThrow();
  });
});
