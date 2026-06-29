import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { asc, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Roadmap Builder end-to-end through the gate: manual creation (default
 * scaffold), assessment-seeded creation (milestones from recommendations),
 * milestone edits with tenant-scoped owner validation, the finalize handoff
 * (one task per milestone, owners carried over), and cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/roadmaps/operations");
let aOps: typeof import("@/domain/assessments/operations");

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

let roadmapId = "";
let firstMilestoneId = "";

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    {
      permission,
      idempotencyKey: key,
      rawBody: "{}",
      action: "roadmap.test",
      resourceType: "roadmap",
      handler,
    },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/roadmaps/operations");
  aOps = await import("@/domain/assessments/operations");

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

describe("roadmaps end-to-end", () => {
  it("creates a manual roadmap with the default scaffold and dependency chain", async () => {
    const res = await run("roadmap:create", "r-create", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "Premier push",
        objective: "Reach Premier tier",
        horizon: "m6",
        scenario: "standard",
        startDate: "2026-02-01",
        sourceAssessmentId: null,
      }),
    );
    roadmapId = res.body.id;
    expect(res.body.milestones).toBe(4);

    const { withTenant } = db.client;
    const { roadmaps, roadmapMilestones } = db.schema;
    const [roadmap] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmaps).where(eq(roadmaps.id, roadmapId)),
    );
    expect(roadmap!.status).toBe("draft");
    expect(roadmap!.source).toBe("manual");

    const ms = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, roadmapId))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    expect(ms.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
    expect(ms[0]!.dependsOnId).toBeNull();
    expect(ms[1]!.dependsOnId).toBe(ms[0]!.id); // linear chain
    firstMilestoneId = ms[0]!.id;
  });

  it("rejects creation by a viewer", async () => {
    await expect(
      run(
        "roadmap:create",
        "r-create-viewer",
        (ctx) =>
          ops.createRoadmapOp(ctx, {
            name: "nope",
            objective: "",
            horizon: "m3",
            scenario: "standard",
            startDate: "2026-02-01",
            sourceAssessmentId: null,
          }),
        () => identity(tenantA, ownerA, "viewer"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("edits a milestone and validates the owner is in-tenant", async () => {
    await run("roadmap:update", "r-update-1", (ctx) =>
      ops.updateMilestoneOp(ctx, {
        milestoneId: firstMilestoneId,
        ownerUserId: memberA,
        targetDate: "2026-03-01",
      }),
    );
    const { withTenant } = db.client;
    const { roadmapMilestones } = db.schema;
    const [m] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmapMilestones).where(eq(roadmapMilestones.id, firstMilestoneId)),
    );
    expect(m!.ownerUserId).toBe(memberA);
    expect(m!.targetDate).toBe("2026-03-01");

    await expect(
      run("roadmap:update", "r-update-badowner", (ctx) =>
        ops.updateMilestoneOp(ctx, { milestoneId: firstMilestoneId, ownerUserId: ownerB }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("finalizes, spawning one owner-carrying task per milestone", async () => {
    const res = await run("roadmap:finalize", `finalize-roadmap:${roadmapId}`, (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId }),
    );
    expect(res.body.tasks).toBe(4);

    const { withTenant } = db.client;
    const { roadmaps, roadmapMilestones, tasks } = db.schema;
    const [roadmap] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmaps).where(eq(roadmaps.id, roadmapId)),
    );
    expect(roadmap!.status).toBe("finalized");
    expect(roadmap!.finalizedAt).not.toBeNull();

    const ms = await withTenant(idA(), (tx) =>
      tx.select().from(roadmapMilestones).where(eq(roadmapMilestones.roadmapId, roadmapId)),
    );
    expect(ms.every((m) => m.taskId !== null)).toBe(true);

    const roadmapTasks = await withTenant(idA(), (tx) =>
      tx.select().from(tasks).where(eq(tasks.source, "roadmap")),
    );
    expect(roadmapTasks).toHaveLength(4);
    // the milestone we assigned carried its owner onto the task
    const owned = roadmapTasks.filter((t) => t.ownerUserId === memberA);
    expect(owned).toHaveLength(1);
  });

  it("blocks a second finalize and edits after finalize", async () => {
    await expect(
      run("roadmap:finalize", "finalize-again", (ctx) =>
        ops.finalizeRoadmapOp(ctx, { roadmapId }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    await expect(
      run("roadmap:update", "r-update-after", (ctx) =>
        ops.updateMilestoneOp(ctx, { milestoneId: firstMilestoneId, targetDate: "2026-04-01" }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("seeds milestones from an assessment's gap modules", async () => {
    // Create + submit an assessment with no answers -> every in-scope module is a gap.
    const created = await gate.runMutation(
      {
        permission: "assessment:create",
        idempotencyKey: "ra-create",
        rawBody: "{}",
        action: "assessment.create",
        resourceType: "assessment",
        resourceId: (r: { id: string }) => r.id,
        handler: (ctx) =>
          aOps.createAssessmentOp(ctx, {
            name: "Seed source",
            preset: "program_submission",
            targetProgram: null,
          }),
      },
      { resolveIdentity: async () => idA() },
    );
    const assessmentId = created.body.id;
    await gate.runMutation(
      {
        permission: "assessment:submit",
        idempotencyKey: `submit:${assessmentId}`,
        rawBody: "{}",
        action: "assessment.submit",
        resourceType: "assessment",
        resourceId: () => assessmentId,
        handler: (ctx) => aOps.submitAssessmentOp(ctx, { assessmentId }),
      },
      { resolveIdentity: async () => idA() },
    );

    const { withTenant } = db.client;
    const { assessmentModules, roadmapMilestones } = db.schema;
    const modules = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(assessmentModules)
        .where(eq(assessmentModules.assessmentId, assessmentId)),
    );
    const gapCount = modules.filter((m) => (m.score ?? 0) < 60).length;
    expect(gapCount).toBeGreaterThan(0);

    const res = await run("roadmap:create", "ra-roadmap", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "From assessment",
        objective: "Close gaps",
        horizon: "m9",
        scenario: "accelerated",
        startDate: "2026-02-01",
        sourceAssessmentId: assessmentId,
      }),
    );
    expect(res.body.milestones).toBe(gapCount);

    const seededMs = await withTenant(idA(), (tx) =>
      tx.select().from(roadmapMilestones).where(eq(roadmapMilestones.roadmapId, res.body.id)),
    );
    expect(seededMs.length).toBeGreaterThan(0);
    expect(seededMs.every((m) => m.title.startsWith("Reach 75+ in "))).toBe(true);
  });

  it("rejects seeding from an assessment with no recommendations", async () => {
    await expect(
      run("roadmap:create", "ra-empty", (ctx) =>
        ops.createRoadmapOp(ctx, {
          name: "bad",
          objective: "",
          horizon: "m6",
          scenario: "standard",
          startDate: "2026-02-01",
          sourceAssessmentId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  // ----- composed from programs + tier -----

  it("composes a roadmap from programs + a target tier with per-milestone owners", async () => {
    const res = await run("roadmap:create", "r-compose", (ctx) =>
      ops.createComposedRoadmapOp(ctx, {
        name: "Differentiation plan",
        objective: "Stand out",
        horizon: "m12",
        scenario: "standard",
        startDate: "2026-02-01",
        programKeys: ["security_competency", "migration_competency"],
        targetTier: "advanced",
        owners: { "program:security_competency": memberA },
      }),
    );
    // 2 programs + advanced's 4 thresholds
    expect(res.body.milestones).toBe(6);

    const { withTenant } = db.client;
    const { roadmaps, roadmapMilestones } = db.schema;
    const [roadmap] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmaps).where(eq(roadmaps.id, res.body.id)),
    );
    expect(roadmap!.source).toBe("composed");

    const ms = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, res.body.id))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    expect(ms).toHaveLength(6);
    expect(ms.filter((m) => m.originKind === "program")).toHaveLength(2);
    expect(ms.filter((m) => m.originKind === "tier")).toHaveLength(4);
    expect(
      ms.filter((m) => m.originKind === "tier").every((m) => m.originLabel === "Advanced tier"),
    ).toBe(true);
    // the program we assigned carried its owner
    const sec = ms.find((m) => m.originLabel === "Security Competency");
    expect(sec!.ownerUserId).toBe(memberA);
    // linear dependency chain still wired across composed milestones
    expect(ms[0]!.dependsOnId).toBeNull();
    expect(ms[1]!.dependsOnId).toBe(ms[0]!.id);
  });

  it("rejects a composed roadmap with no selections", async () => {
    await expect(
      run("roadmap:create", "r-compose-empty", (ctx) =>
        ops.createComposedRoadmapOp(ctx, {
          name: "empty",
          objective: "",
          horizon: "m6",
          scenario: "standard",
          startDate: "2026-02-01",
          programKeys: [],
          targetTier: null,
          owners: {},
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects a composed roadmap assigning an out-of-tenant owner", async () => {
    await expect(
      run("roadmap:create", "r-compose-badowner", (ctx) =>
        ops.createComposedRoadmapOp(ctx, {
          name: "x",
          objective: "",
          horizon: "m6",
          scenario: "standard",
          startDate: "2026-02-01",
          programKeys: ["isv_accelerate"],
          targetTier: null,
          owners: { "program:isv_accelerate": ownerB },
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's roadmaps", async () => {
    const { withTenant } = db.client;
    const { roadmaps } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(roadmaps),
    );
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging a roadmap into another tenant", async () => {
    const { withTenant } = db.client;
    const { roadmaps } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(roadmaps).values({
          tenantId: tenantA,
          name: "forged",
          startDate: "2026-02-01",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("roadmaps living-plan editing (increment 2)", () => {
  let rid = "";
  let ids: string[] = [];

  async function milestones(): Promise<
    Array<{ id: string; sequence: number; dependsOnId: string | null; status: string; title: string; ownerUserId: string | null }>
  > {
    const { withTenant } = db.client;
    const { roadmapMilestones } = db.schema;
    return withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, rid))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
  }

  beforeAll(async () => {
    const res = await run("roadmap:create", "lp-create", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "Living plan",
        objective: "Track progress",
        horizon: "m6",
        scenario: "standard",
        startDate: "2026-02-01",
        sourceAssessmentId: null,
      }),
    );
    rid = res.body.id;
    ids = (await milestones()).map((m) => m.id);
    expect(ids).toHaveLength(4);
  });

  it("sets a milestone status", async () => {
    await run("roadmap:update", "lp-status", (ctx) =>
      ops.setMilestoneStatusOp(ctx, { milestoneId: ids[0]!, status: "in_progress" }),
    );
    expect((await milestones())[0]!.status).toBe("in_progress");
  });

  it("reorders milestones and re-wires the linear dependency chain", async () => {
    const reversed = [...ids].reverse();
    await run("roadmap:update", "lp-reorder", (ctx) =>
      ops.reorderMilestonesOp(ctx, { roadmapId: rid, orderedIds: reversed }),
    );
    const ms = await milestones();
    expect(ms.map((m) => m.id)).toEqual(reversed);
    expect(ms.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
    expect(ms[0]!.dependsOnId).toBeNull();
    expect(ms[1]!.dependsOnId).toBe(ms[0]!.id);
    expect(ms[3]!.dependsOnId).toBe(ms[2]!.id);
    ids = ms.map((m) => m.id);
  });

  it("rejects a reorder that is not a permutation of the milestones", async () => {
    await expect(
      run("roadmap:update", "lp-reorder-bad", (ctx) =>
        ops.reorderMilestonesOp(ctx, { roadmapId: rid, orderedIds: [ids[0]!] }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("appends a milestone with an in-tenant owner", async () => {
    await run("roadmap:update", "lp-add", (ctx) =>
      ops.addMilestoneOp(ctx, {
        roadmapId: rid,
        title: "Extra step",
        detail: "added later",
        targetDate: "2026-08-01",
        ownerUserId: memberA,
      }),
    );
    const ms = await milestones();
    expect(ms).toHaveLength(5);
    expect(ms.at(-1)!.title).toBe("Extra step");
    expect(ms.at(-1)!.sequence).toBe(5);
    expect(ms.at(-1)!.ownerUserId).toBe(memberA);
    ids = ms.map((m) => m.id);
  });

  it("removes a milestone and recompacts sequences + chain", async () => {
    const removeId = ids[2]!;
    await run("roadmap:update", "lp-remove", (ctx) =>
      ops.removeMilestoneOp(ctx, { milestoneId: removeId }),
    );
    const ms = await milestones();
    expect(ms).toHaveLength(4);
    expect(ms.some((m) => m.id === removeId)).toBe(false);
    expect(ms.map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
    expect(ms[0]!.dependsOnId).toBeNull();
    expect(ms[1]!.dependsOnId).toBe(ms[0]!.id);
    ids = ms.map((m) => m.id);
  });

  it("keeps status editable after finalize but blocks structural edits", async () => {
    await run("roadmap:finalize", `finalize-roadmap:${rid}`, (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: rid }),
    );
    // status still works (living plan)
    await run("roadmap:update", "lp-status-final", (ctx) =>
      ops.setMilestoneStatusOp(ctx, { milestoneId: ids[0]!, status: "done" }),
    );
    expect((await milestones())[0]!.status).toBe("done");
    // structural edits are now rejected
    await expect(
      run("roadmap:update", "lp-add-final", (ctx) =>
        ops.addMilestoneOp(ctx, {
          roadmapId: rid,
          title: "nope",
          detail: "",
          targetDate: "2026-09-01",
          ownerUserId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
    await expect(
      run("roadmap:update", "lp-reorder-final", (ctx) =>
        ops.reorderMilestonesOp(ctx, { roadmapId: rid, orderedIds: [...ids].reverse() }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("won't remove the last remaining milestone", async () => {
    // a fresh single-milestone roadmap (manual default has 4; drain to 1)
    const res = await run("roadmap:create", "lp-solo", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "Solo",
        objective: "",
        horizon: "m3",
        scenario: "standard",
        startDate: "2026-02-01",
        sourceAssessmentId: null,
      }),
    );
    const soloId = res.body.id;
    const { withTenant } = db.client;
    const { roadmapMilestones } = db.schema;
    let ms = await withTenant(idA(), (tx) =>
      tx
        .select({ id: roadmapMilestones.id })
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, soloId))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    // remove down to one
    for (let i = 0; i < ms.length - 1; i++) {
      await run("roadmap:update", `lp-solo-rm-${i}`, (ctx) =>
        ops.removeMilestoneOp(ctx, { milestoneId: ms[i]!.id }),
      );
    }
    const last = ms.at(-1)!.id;
    await expect(
      run("roadmap:update", "lp-solo-rm-last", (ctx) =>
        ops.removeMilestoneOp(ctx, { milestoneId: last }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});

describe("roadmaps finalize -> action (increment 3)", () => {
  it("adopts the selected programs and opens the tier plan on finalize", async () => {
    const res = await run("roadmap:create", "i3-compose", (ctx) =>
      ops.createComposedRoadmapOp(ctx, {
        name: "Differentiate + advance",
        objective: "",
        horizon: "m12",
        scenario: "standard",
        startDate: "2026-02-01",
        programKeys: ["security_competency", "isv_accelerate"],
        targetTier: "select",
        owners: {},
      }),
    );
    const rid = res.body.id;

    const { withTenant } = db.client;
    const { roadmapMilestones, programs, tierPlans, tierRequirements } = db.schema;

    // origin_ref persisted so finalize knows what to adopt
    const ms = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, rid))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    expect(ms.find((m) => m.originKind === "program")!.originRef).toBeTruthy();
    expect(ms.find((m) => m.originKind === "tier")!.originRef).toMatch(/^select:/);

    const fin = await run("roadmap:finalize", `finalize-roadmap:${rid}`, (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: rid }),
    );
    expect(fin.body.programsAdopted).toBe(2);
    expect(fin.body.tierPlanCreated).toBe(true);

    const progs = await withTenant(idA(), (tx) => tx.select().from(programs));
    const keys = new Set(progs.map((p) => p.libraryKey));
    expect(keys.has("security_competency")).toBe(true);
    expect(keys.has("isv_accelerate")).toBe(true);

    const plans = await withTenant(idA(), (tx) => tx.select().from(tierPlans));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.targetTier).toBe("select");
    const treqs = await withTenant(idA(), (tx) =>
      tx.select().from(tierRequirements),
    );
    expect(treqs.length).toBeGreaterThan(0);
  });

  it("is idempotent: an adopted program / existing plan are not duplicated", async () => {
    const { withSystem, withTenant } = db.client;
    const { programs, tierPlans } = db.schema;

    // migration_competency is already in the portfolio before finalize
    await withSystem(async (tx) => {
      await tx.insert(programs).values({
        tenantId: tenantA,
        libraryKey: "migration_competency",
        name: "Migration Competency",
        programType: "Competency",
        deliveryModel: "Consulting",
        fundingFit: "high",
        createdBy: ownerA,
      });
    });

    const res = await run("roadmap:create", "i3-compose-2", (ctx) =>
      ops.createComposedRoadmapOp(ctx, {
        name: "Already adopted",
        objective: "",
        horizon: "m6",
        scenario: "standard",
        startDate: "2026-02-01",
        programKeys: ["migration_competency"],
        targetTier: "select", // a 'select' plan already exists from the prior test
        owners: {},
      }),
    );
    const fin = await run("roadmap:finalize", `finalize-roadmap:${res.body.id}`, (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: res.body.id }),
    );
    // both already exist -> nothing new adopted, and no crash
    expect(fin.body.programsAdopted).toBe(0);
    expect(fin.body.tierPlanCreated).toBe(false);

    const mig = await withTenant(idA(), (tx) =>
      tx.select().from(programs).where(eq(programs.libraryKey, "migration_competency")),
    );
    expect(mig).toHaveLength(1);
    const plans = await withTenant(idA(), (tx) => tx.select().from(tierPlans));
    expect(plans).toHaveLength(1);
  });
});

describe("roadmaps <-> tasks status sync (T3)", () => {
  let tOps: typeof import("@/domain/tasks/operations");
  let firstMsId = "";
  let firstTaskId = "";

  beforeAll(async () => {
    tOps = await import("@/domain/tasks/operations");
    const res = await run("roadmap:create", "sync-create", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "Sync plan",
        objective: "",
        horizon: "m6",
        scenario: "standard",
        startDate: "2026-02-01",
        sourceAssessmentId: null,
      }),
    );
    const rid = res.body.id;
    await run("roadmap:finalize", `finalize-roadmap:${rid}`, (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: rid }),
    );
    const { withTenant } = db.client;
    const { roadmapMilestones } = db.schema;
    const ms = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, rid))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    firstMsId = ms[0]!.id;
    firstTaskId = ms[0]!.taskId!;
    expect(firstTaskId).toBeTruthy();
  });

  it("completing the task marks its milestone done", async () => {
    await run("task:complete", "sync-task-done", (ctx) =>
      tOps.completeTaskOp(ctx, { taskId: firstTaskId }),
    );
    const { withTenant } = db.client;
    const { roadmapMilestones } = db.schema;
    const [m] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmapMilestones).where(eq(roadmapMilestones.id, firstMsId)),
    );
    expect(m!.status).toBe("done");
  });

  it("changing the milestone status updates its task (no feedback loop)", async () => {
    await run("roadmap:update", "sync-ms-blocked", (ctx) =>
      ops.setMilestoneStatusOp(ctx, { milestoneId: firstMsId, status: "blocked" }),
    );
    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const [t] = await withTenant(idA(), (tx) =>
      tx.select().from(tasks).where(eq(tasks.id, firstTaskId)),
    );
    expect(t!.status).toBe("blocked");
  });
});

describe("roadmaps recompose a draft (T3)", () => {
  it("appends new catalog milestones, skipping ones already present", async () => {
    const res = await run("roadmap:create", "recompose-base", (ctx) =>
      ops.createComposedRoadmapOp(ctx, {
        name: "Grow plan",
        objective: "",
        horizon: "m12",
        scenario: "standard",
        startDate: "2026-02-01",
        programKeys: ["isv_accelerate"],
        targetTier: null,
        owners: {},
      }),
    );
    const rid = res.body.id;
    const { withTenant } = db.client;
    const { roadmapMilestones } = db.schema;
    const before = await withTenant(idA(), (tx) =>
      tx.select().from(roadmapMilestones).where(eq(roadmapMilestones.roadmapId, rid)),
    );
    expect(before).toHaveLength(1);

    const r = await run("roadmap:update", "recompose-1", (ctx) =>
      ops.recomposeRoadmapOp(ctx, {
        roadmapId: rid,
        programKeys: ["isv_accelerate", "security_competency"],
        targetTier: "select",
      }),
    );
    // isv already present -> skipped; security_competency (1) + select's 3 thresholds
    expect(r.body.added).toBe(4);

    const after = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, rid))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    expect(after).toHaveLength(5);
    expect(after.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(after[1]!.dependsOnId).toBe(after[0]!.id);

    const r2 = await run("roadmap:update", "recompose-2", (ctx) =>
      ops.recomposeRoadmapOp(ctx, {
        roadmapId: rid,
        programKeys: ["isv_accelerate", "security_competency"],
        targetTier: "select",
      }),
    );
    expect(r2.body.added).toBe(0);
  });

  it("rejects recompose on a finalized roadmap", async () => {
    const res = await run("roadmap:create", "recompose-locked", (ctx) =>
      ops.createComposedRoadmapOp(ctx, {
        name: "Locked plan",
        objective: "",
        horizon: "m6",
        scenario: "standard",
        startDate: "2026-02-01",
        programKeys: ["migration_competency"],
        targetTier: null,
        owners: {},
      }),
    );
    const rid = res.body.id;
    await run("roadmap:finalize", `finalize-roadmap:${rid}`, (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: rid }),
    );
    await expect(
      run("roadmap:update", "recompose-locked-try", (ctx) =>
        ops.recomposeRoadmapOp(ctx, {
          roadmapId: rid,
          programKeys: ["security_competency"],
          targetTier: null,
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});

describe("roadmaps share & iterate (T4)", () => {
  it("duplicates a roadmap as a fresh draft, resetting progress + remapping deps", async () => {
    const res = await run("roadmap:create", "dup-base", (ctx) =>
      ops.createComposedRoadmapOp(ctx, {
        name: "Original",
        objective: "obj",
        horizon: "m12",
        scenario: "standard",
        startDate: "2026-02-01",
        programKeys: ["isv_accelerate"],
        targetTier: "select",
        owners: {},
      }),
    );
    const srcId = res.body.id;
    const { withTenant } = db.client;
    const { roadmaps, roadmapMilestones } = db.schema;
    const srcMs = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, srcId))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    await run("roadmap:update", "dup-status", (ctx) =>
      ops.setMilestoneStatusOp(ctx, { milestoneId: srcMs[0]!.id, status: "done" }),
    );
    await run("roadmap:update", "dup-owner", (ctx) =>
      ops.updateMilestoneOp(ctx, { milestoneId: srcMs[0]!.id, ownerUserId: memberA }),
    );

    const dup = await run("roadmap:create", "dup-go", (ctx) =>
      ops.duplicateRoadmapOp(ctx, { roadmapId: srcId }),
    );
    expect(dup.body.milestones).toBe(srcMs.length);

    const [copy] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmaps).where(eq(roadmaps.id, dup.body.id)),
    );
    expect(copy!.status).toBe("draft");
    expect(copy!.name).toBe("Original (copy)");

    const copyMs = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, dup.body.id))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    expect(copyMs.every((m) => m.status === "planned")).toBe(true);
    expect(copyMs.every((m) => m.taskId === null)).toBe(true);
    expect(copyMs[0]!.ownerUserId).toBe(memberA);
    expect(copyMs[1]!.dependsOnId).toBe(copyMs[0]!.id);
  });

  it("re-opens a finalized roadmap; re-finalize is idempotent (no duplicate tasks)", async () => {
    const res = await run("roadmap:create", "t4-reopen-base", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "Reopen me",
        objective: "",
        horizon: "m6",
        scenario: "standard",
        startDate: "2026-02-01",
        sourceAssessmentId: null,
      }),
    );
    const rid = res.body.id;
    const fin1 = await run("roadmap:finalize", "t4-reopen-fin1", (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: rid }),
    );
    expect(fin1.body.tasks).toBe(4);

    await run("roadmap:finalize", "t4-reopen-go", (ctx) =>
      ops.reopenRoadmapOp(ctx, { roadmapId: rid }),
    );
    const { withTenant } = db.client;
    const { roadmaps, tasks } = db.schema;
    const [r] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmaps).where(eq(roadmaps.id, rid)),
    );
    expect(r!.status).toBe("draft");
    expect(r!.finalizedAt).toBeNull();

    const fin2 = await run("roadmap:finalize", "t4-reopen-fin2", (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: rid }),
    );
    expect(fin2.body.tasks).toBe(0); // all sourceRef-deduped, no new tasks
    const forThis = await withTenant(idA(), (tx) =>
      tx.select().from(tasks).where(eq(tasks.source, "roadmap")),
    );
    expect(forThis.filter((t) => t.sourceRef?.startsWith(`${rid}:`))).toHaveLength(4);
  });

  it("rejects re-open on a draft", async () => {
    const res = await run("roadmap:create", "t4-reopen-draft", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "Draft",
        objective: "",
        horizon: "m6",
        scenario: "standard",
        startDate: "2026-02-01",
        sourceAssessmentId: null,
      }),
    );
    await expect(
      run("roadmap:finalize", "t4-reopen-draft-try", (ctx) =>
        ops.reopenRoadmapOp(ctx, { roadmapId: res.body.id }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("re-plans a draft (later horizon pushes dates out); finalized rejected", async () => {
    const res = await run("roadmap:create", "t4-replan-base", (ctx) =>
      ops.createRoadmapOp(ctx, {
        name: "Replan",
        objective: "",
        horizon: "m3",
        scenario: "standard",
        startDate: "2026-02-01",
        sourceAssessmentId: null,
      }),
    );
    const rid = res.body.id;
    const { withTenant } = db.client;
    const { roadmaps, roadmapMilestones } = db.schema;
    const before = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, rid))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    const lastBefore = before.at(-1)!.targetDate;

    await run("roadmap:update", "t4-replan-go", (ctx) =>
      ops.replanRoadmapOp(ctx, {
        roadmapId: rid,
        horizon: "m18",
        scenario: "standard",
        startDate: "2026-02-01",
      }),
    );
    const [r] = await withTenant(idA(), (tx) =>
      tx.select().from(roadmaps).where(eq(roadmaps.id, rid)),
    );
    expect(r!.horizon).toBe("m18");
    const after = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(roadmapMilestones)
        .where(eq(roadmapMilestones.roadmapId, rid))
        .orderBy(asc(roadmapMilestones.sequence)),
    );
    expect(after.at(-1)!.targetDate > lastBefore).toBe(true);

    await run("roadmap:finalize", "t4-replan-fin", (ctx) =>
      ops.finalizeRoadmapOp(ctx, { roadmapId: rid }),
    );
    await expect(
      run("roadmap:update", "t4-replan-locked", (ctx) =>
        ops.replanRoadmapOp(ctx, {
          roadmapId: rid,
          horizon: "m6",
          scenario: "standard",
          startDate: "2026-02-01",
        }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});
