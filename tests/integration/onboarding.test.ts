import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Onboarding end-to-end through the gate: the wizard (start -> context ->
 * objectives -> path -> review), back-navigation, the completion handoff that
 * spawns a starter assessment and seeds onboarding tasks, the once-only guard,
 * authz, and cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/onboarding/operations");
let catalog: typeof import("@/domain/onboarding/catalog");
let activationLoad: typeof import("@/domain/onboarding/activation-load");
let activation: typeof import("@/domain/onboarding/activation");

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

const ok = () => ({ ok: true });

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/onboarding/operations");
  catalog = await import("@/domain/onboarding/catalog");
  activationLoad = await import("@/domain/onboarding/activation-load");
  activation = await import("@/domain/onboarding/activation");

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

const idA = () => identity(tenantA, ownerA);

async function run<T>(
  spec: {
    permission: "onboarding:manage";
    key: string;
    handler: (ctx: import("@/gate/mutation-gate").MutationContext) => Promise<T>;
  },
  who = idA,
) {
  return gate.runMutation(
    {
      permission: spec.permission,
      idempotencyKey: spec.key,
      rawBody: "{}",
      action: "onboarding.test",
      resourceType: "onboarding",
      handler: spec.handler,
    },
    { resolveIdentity: async () => who() },
  );
}

describe("onboarding end-to-end", () => {
  it("rejects start by a member (no onboarding:manage)", async () => {
    await expect(
      run(
        { permission: "onboarding:manage", key: "m-start", handler: (ctx) => ops.startOnboardingOp(ctx) },
        () => identity(tenantA, memberA, "member"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("starts at the context step", async () => {
    const res = await run({
      permission: "onboarding:manage",
      key: "start",
      handler: (ctx) => ops.startOnboardingOp(ctx),
    });
    expect(res.body.step).toBe("context");
  });

  it("blocks completion before review", async () => {
    await expect(
      run({ permission: "onboarding:manage", key: "early", handler: (ctx) => ops.completeOnboardingOp(ctx) }),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("walks the wizard and normalizes objectives", async () => {
    await run({
      permission: "onboarding:manage",
      key: "ctx",
      handler: (ctx) =>
        ops
          .saveContextOp(ctx, {
            companyName: "Acme",
            industry: catalog.INDUSTRY_OPTIONS[0]!,
            partnerType: catalog.PARTNER_TYPE_OPTIONS[0]!,
            awsStage: "Advanced", // exercises the upward-only tier estimate on completion
            teamSize: catalog.TEAM_SIZE_OPTIONS[0]!,
          })
          .then(ok),
    });
    await run({
      permission: "onboarding:manage",
      key: "obj",
      handler: (ctx) =>
        ops
          .saveObjectivesOp(ctx, { objectives: ["mdf", "tier_advancement", "bogus"] })
          .then(ok),
    });
    await run({
      permission: "onboarding:manage",
      key: "path",
      handler: (ctx) => ops.choosePathOp(ctx, { path: "foundations" }).then(ok),
    });

    const { withTenant } = db.client;
    const { onboarding } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(onboarding).where(eq(onboarding.tenantId, tenantA)),
    );
    expect(row!.step).toBe("review");
    expect(row!.companyName).toBe("Acme");
    expect(row!.objectives).toEqual(["tier_advancement", "mdf"]);
    expect(row!.path).toBe("foundations");
  });

  it("supports back-navigation to an earlier step", async () => {
    await run({
      permission: "onboarding:manage",
      key: "back",
      handler: (ctx) => ops.setStepOp(ctx, { step: "objectives" }).then(ok),
    });
    const { withTenant } = db.client;
    const { onboarding } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select({ step: onboarding.step }).from(onboarding).where(eq(onboarding.tenantId, tenantA)),
    );
    expect(row!.step).toBe("objectives");

    // move forward again to the review step
    await run({
      permission: "onboarding:manage",
      key: "path2",
      handler: (ctx) => ops.choosePathOp(ctx, { path: "foundations" }).then(ok),
    });
  });

  it("completion seeds assessment + objective tasks + tier estimate + starter roadmap", async () => {
    const res = await run({
      permission: "onboarding:manage",
      key: "complete",
      handler: (ctx) => ops.completeOnboardingOp(ctx),
    });
    expect(res.body.assessmentId).toMatch(/[0-9a-f-]{36}/);
    // baseline(3) + path(1) + obj:tier_advancement + obj:mdf
    expect(res.body.tasks).toBe(6);
    expect(res.body.roadmapId).toMatch(/[0-9a-f-]{36}/);

    const { withTenant } = db.client;
    const { onboarding, assessments, tasks, tenants, roadmaps, roadmapMilestones } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(onboarding).where(eq(onboarding.tenantId, tenantA)),
    );
    expect(row!.status).toBe("completed");
    expect(row!.step).toBe("done");
    expect(row!.assessmentId).toBe(res.body.assessmentId);

    const [assessment] = await withTenant(idA(), (tx) =>
      tx.select().from(assessments).where(eq(assessments.id, res.body.assessmentId)),
    );
    expect(assessment!.preset).toBe("program_submission"); // foundations
    expect(assessment!.status).toBe("draft");

    const seeded = await withTenant(idA(), (tx) =>
      tx.select().from(tasks).where(eq(tasks.source, "onboarding")),
    );
    expect(seeded).toHaveLength(6);
    expect(seeded.some((t) => t.sourceRef === `${row!.id}:obj:tier_advancement`)).toBe(true);
    expect(seeded.some((t) => t.sourceRef === `${row!.id}:obj:mdf`)).toBe(true);

    // Tier estimate: Advanced stage bumps the still-default 'registered' tenant.
    const [tenant] = await withTenant(idA(), (tx) =>
      tx.select({ tier: tenants.tier }).from(tenants).where(eq(tenants.id, tenantA)),
    );
    expect(tenant!.tier).toBe("advanced");

    // Starter roadmap: a composed draft with milestones.
    const [rm] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmaps).where(eq(roadmaps.id, res.body.roadmapId!)),
    );
    expect(rm!.source).toBe("composed");
    const ms = await withTenant(idA(), (tx) =>
      tx.select().from(roadmapMilestones).where(eq(roadmapMilestones.roadmapId, res.body.roadmapId!)),
    );
    expect(ms.length).toBeGreaterThan(0);
  });

  it("activation checklist reflects the seeded workspace, isolated per tenant", async () => {
    const { answers, counts } = await activationLoad.loadActivation(idA());
    expect(counts.roadmaps).toBeGreaterThan(0); // the starter roadmap
    expect(answers.objectives).toEqual(["tier_advancement", "mdf"]);
    const check = activation.activationChecklist(answers, counts);
    // roadmap baseline item done; the tier_advancement objective added an item.
    expect(check.items.find((i) => i.key === "roadmap")!.done).toBe(true);
    expect(check.items.some((i) => i.key === "obj:tier_advancement")).toBe(true);
    expect(check.complete).toBe(false);

    // RLS: tenant B sees an empty workspace.
    const b = await activationLoad.loadActivation(identity(tenantB, ownerB));
    expect(b.counts.roadmaps).toBe(0);
    expect(b.answers.objectives).toEqual([]);
  });

  it("blocks a second completion (status-guarded)", async () => {
    await expect(
      run({ permission: "onboarding:manage", key: "complete-2", handler: (ctx) => ops.completeOnboardingOp(ctx) }),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("tenant B cannot see tenant A's onboarding", async () => {
    const { withTenant } = db.client;
    const { onboarding } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(onboarding),
    );
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging onboarding into another tenant", async () => {
    const { withTenant } = db.client;
    const { onboarding } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(onboarding).values({ tenantId: tenantA }),
      ),
    ).rejects.toThrow();
  });
});
