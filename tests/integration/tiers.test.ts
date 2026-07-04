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
let reqs: {
  id: string;
  key: string;
  threshold: number;
  secondaryThreshold: number | null;
  informational: boolean;
}[] = [];
const byKey = (key: string) => reqs.find((r) => r.key === key)!;

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
    expect(res.body.requirements).toBe(7); // advanced: the fee + 6 gating thresholds

    const { withTenant } = db.client;
    const { tierPlans, tierRequirements } = db.schema;
    const [plan] = await withTenant(idA(), (tx) => tx.select().from(tierPlans).where(eq(tierPlans.id, planId)));
    expect(plan!.currentTier).toBe("select");
    expect(plan!.targetTier).toBe("advanced");

    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(tierRequirements).where(eq(tierRequirements.planId, planId)),
    );
    reqs = rows.map((r) => ({
      id: r.id,
      key: r.requirementKey,
      threshold: r.threshold,
      secondaryThreshold: r.secondaryThreshold,
      informational: r.informational,
    }));
    expect(reqs).toHaveLength(7);
    // The annual fee is seeded as an informational (non-gating) requirement.
    expect(byKey("annual_apn_fee").informational).toBe(true);
    expect(reqs.filter((r) => !r.informational)).toHaveLength(6);
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
    const target = byKey("accredited_technical");
    await run("tier:update", "update-req", (ctx) =>
      ops.updateRequirementOp(ctx, { requirementId: target.id, currentValue: 2, ownerUserId: memberA }),
    );
    const { withTenant } = db.client;
    const { tierRequirements } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(tierRequirements).where(eq(tierRequirements.id, target.id)));
    expect(r!.currentValue).toBe(2);
    expect(r!.ownerUserId).toBe(memberA);

    await expect(
      run("tier:update", "update-badowner", (ctx) => ops.updateRequirementOp(ctx, { requirementId: target.id, ownerUserId: ownerB })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("records a secondary current value alongside the primary", async () => {
    const tech = byKey("technical_certs"); // advanced: threshold 6, secondary Professional/Specialty >= 3
    await run("tier:update", "update-secondary", (ctx) =>
      ops.updateRequirementOp(ctx, { requirementId: tech.id, currentValue: 6, secondaryCurrentValue: 3 }),
    );
    const { withTenant } = db.client;
    const { tierRequirements } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(tierRequirements).where(eq(tierRequirements.id, tech.id)));
    expect(r!.currentValue).toBe(6);
    expect(r!.secondaryCurrentValue).toBe(3);
  });

  it("hands a requirement off to a task and to evidence (idempotent)", async () => {
    const cert = byKey("foundational_certs"); // category 'certifications' -> certification evidence
    const t1 = await run("tier:update", "req-task", (ctx) => ops.createTaskFromTierRequirementOp(ctx, { requirementId: cert.id }));
    expect(t1.body.taskId).not.toBeNull();
    const t2 = await run("tier:update", "req-task-2", (ctx) => ops.createTaskFromTierRequirementOp(ctx, { requirementId: cert.id }));
    expect(t2.body.taskId).toBeNull();

    const e1 = await run("tier:update", "req-ev", (ctx) => ops.stageEvidenceForTierRequirementOp(ctx, { requirementId: cert.id }));
    expect(e1.body.evidenceId).not.toBeNull();

    const { withTenant } = db.client;
    const { tasks, evidence } = db.schema;
    const tierTasks = await withTenant(idA(), (tx) => tx.select().from(tasks).where(eq(tasks.source, "tier")));
    expect(tierTasks).toHaveLength(1);
    const tierEvidence = await withTenant(idA(), (tx) => tx.select().from(evidence).where(eq(evidence.source, "tier")));
    expect(tierEvidence).toHaveLength(1);
    expect(tierEvidence[0]!.evidenceType).toBe("certification"); // certifications -> certification
  });

  it("titles a boolean requirement's task as a completion, not a threshold", async () => {
    const bool = byKey("partner_business_plan"); // kind: boolean
    const res = await run("tier:update", "bool-task", (ctx) =>
      ops.createTaskFromTierRequirementOp(ctx, { requirementId: bool.id }),
    );
    expect(res.body.taskId).not.toBeNull();
    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const [task] = await withTenant(idA(), (tx) => tx.select().from(tasks).where(eq(tasks.id, res.body.taskId!)));
    expect(task!.title).toBe("Complete: Partner Business Plan");
  });

  it("blocks advancement until every threshold (incl. secondary gates) is met, then advances", async () => {
    await expect(
      run("tier:advance", "advance-early", (ctx) => ops.advanceTierOp(ctx, { planId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    // Meet every gating primary (booleans use threshold 1; the informational fee is
    // excluded from the gate so it is left alone) — but not yet the secondary gates.
    for (const r of reqs.filter((x) => !x.informational)) {
      await run("tier:update", `meet-primary-${r.key}`, (ctx) =>
        ops.updateRequirementOp(ctx, { requirementId: r.id, currentValue: r.threshold }),
      );
    }
    // Launched opportunities still needs its Total MRR — the secondary gate blocks advancement.
    await expect(
      run("tier:advance", "advance-no-secondary", (ctx) => ops.advanceTierOp(ctx, { planId })),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    // Satisfy the secondary numeric gates (MRR, Professional/Specialty certs).
    for (const r of reqs.filter((x) => x.secondaryThreshold !== null)) {
      await run("tier:update", `meet-secondary-${r.key}`, (ctx) =>
        ops.updateRequirementOp(ctx, {
          requirementId: r.id,
          secondaryCurrentValue: r.secondaryThreshold!,
        }),
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

/**
 * Auto-measurement: syncTierMeasuredValuesOp writes the platform-derivable values
 * (launched-opportunity count, adopted-Competency count, sustained attainment) onto
 * the plan's matching requirement rows, leaving manually-entered ones untouched.
 * Uses tenant B (must run after the isolation test above, which asserts B has no plan).
 */
describe("syncTierMeasuredValuesOp auto-measures derivable requirements", () => {
  const idB = () => identity(tenantB, ownerB);
  let bPlanId = "";
  const TODAY = "2026-06-30";

  it("seeds a premier plan with derivable requirements and domain data to measure", async () => {
    const { withSystem } = db.client;
    const { opportunities, programs } = db.schema;
    await withSystem(async (tx) => {
      await tx.insert(opportunities).values([
        { tenantId: tenantB, name: "Launched A", stage: "launched" },
        { tenantId: tenantB, name: "Launched B", stage: "launched" },
        { tenantId: tenantB, name: "Prospect C", stage: "prospect" }, // excluded
      ]);
      await tx.insert(programs).values([
        { tenantId: tenantB, libraryKey: "msp", name: "MSP", programType: "MSP", deliveryModel: "managed", fundingFit: "strong", status: "active" },
        { tenantId: tenantB, libraryKey: "comp", name: "A Competency", programType: "Competency", deliveryModel: "build", fundingFit: "strong", status: "active" },
        { tenantId: tenantB, libraryKey: "spec-pending", name: "Spec (pending)", programType: "Specialization", deliveryModel: "build", fundingFit: "strong", status: "pending" }, // excluded
      ]);
    });

    const res = await run("tier:create", "b-create-plan", (ctx) => ops.createTierPlanOp(ctx, { targetTier: "premier" }), idB);
    bPlanId = res.body.id;
    expect(res.body.requirements).toBe(10); // premier: the fee + 9 gating thresholds
  });

  it("writes launched-opp and competency counts; sustained is 0 for an un-achieved plan", async () => {
    const res = await run("tier:update", "b-sync-1", (ctx) => ops.syncTierMeasuredValuesOp(ctx, { today: TODAY }), idB);
    expect(res.body.updated).toBe(3); // launched_opportunities, competencies, sustained_attainment
    expect(res.body.changes.length).toBe(2); // launched + competencies moved off their seeded 0; sustained stayed 0

    const { withTenant } = db.client;
    const { tierRequirements } = db.schema;
    const rows = await withTenant(idB(), (tx) =>
      tx.select().from(tierRequirements).where(eq(tierRequirements.planId, bPlanId)),
    );
    const value = Object.fromEntries(rows.map((r) => [r.requirementKey, r.currentValue]));
    expect(value["launched_opportunities"]).toBe(2); // the prospect is excluded
    expect(value["competencies"]).toBe(2); // the pending program is excluded
    expect(value["sustained_attainment"]).toBe(0); // plan not achieved yet
    // A non-derivable requirement (manually entered) is left untouched.
    expect(value["accredited_technical"]).toBe(0);
  });

  it("sets sustained attainment once the tier has been held 6+ months", async () => {
    const { withSystem, withTenant } = db.client;
    const { tierPlans, tierRequirements } = db.schema;
    const achievedAt = new Date(Date.parse(TODAY) - 220 * 86_400_000); // ~7 months ago
    await withSystem((tx) =>
      tx.update(tierPlans).set({ achievedAt }).where(eq(tierPlans.id, bPlanId)),
    );

    const res = await run("tier:update", "b-sync-2", (ctx) => ops.syncTierMeasuredValuesOp(ctx, { today: TODAY }), idB);
    expect(res.body.updated).toBe(3);
    expect(res.body.changes.length).toBe(1); // only sustained_attainment moved (0 -> 1)

    const rows = await withTenant(idB(), (tx) =>
      tx.select().from(tierRequirements).where(eq(tierRequirements.planId, bPlanId)),
    );
    const value = Object.fromEntries(rows.map((r) => [r.requirementKey, r.currentValue]));
    expect(value["sustained_attainment"]).toBe(1);
  });

  it("is idempotent — re-syncing yields the same measured values", async () => {
    const res = await run("tier:update", "b-sync-3", (ctx) => ops.syncTierMeasuredValuesOp(ctx, { today: TODAY }), idB);
    expect(res.body.planId).toBe(bPlanId);
    expect(res.body.changes).toEqual([]); // re-syncing moves nothing — clean idempotency

    const { withTenant } = db.client;
    const { tierRequirements } = db.schema;
    const rows = await withTenant(idB(), (tx) =>
      tx.select().from(tierRequirements).where(eq(tierRequirements.planId, bPlanId)),
    );
    const value = Object.fromEntries(rows.map((r) => [r.requirementKey, r.currentValue]));
    expect(value["launched_opportunities"]).toBe(2);
    expect(value["competencies"]).toBe(2);
    expect(value["sustained_attainment"]).toBe(1); // still achieved 6+ months ago
  });
});
