import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Task Manager end-to-end against real Postgres, driven through the same gate
 * the actions use: task lifecycle (create/update/complete), tenant-scoped owner
 * validation, cross-tenant RLS, and the load-bearing cross-section handoff —
 * approving an assessment recommendation spawns a source-linked task.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let tasksOps: typeof import("@/domain/tasks/operations");
let aOps: typeof import("@/domain/assessments/operations");
let catalog: typeof import("@/domain/assessments/catalog");

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

const BEST: Record<string, string> = {
  "gtm.exec_sponsor": "yes",
  "gtm.joint_plan": "optimized",
  "gtm.pipeline": "optimized",
  "competency.case_studies": "3plus",
  "competency.tech_validation": "optimized",
  "competency.certified_staff": "yes",
  "evidence.coverage": "optimized",
  "evidence.freshness": "yes",
  "evidence.organization": "optimized",
};

let taskId = "";

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  tasksOps = await import("@/domain/tasks/operations");
  aOps = await import("@/domain/assessments/operations");
  catalog = await import("@/domain/assessments/catalog");

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

describe("tasks end-to-end", () => {
  it("creates a manual task", async () => {
    const res = await gate.runMutation(
      {
        permission: "task:create",
        idempotencyKey: "t-create-1",
        rawBody: "{}",
        action: "task.create",
        resourceType: "task",
        resourceId: (r: { id: string }) => r.id,
        handler: (ctx) =>
          tasksOps.createTaskOp(ctx, {
            title: "Prepare QBR deck",
            description: "Draft the quarterly review",
            priority: "high",
            ownerUserId: null,
            dueDate: "2026-07-15",
          }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );
    taskId = res.body.id;

    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const [row] = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select().from(tasks).where(eq(tasks.id, taskId)),
    );
    expect(row!.title).toBe("Prepare QBR deck");
    expect(row!.source).toBe("manual");
    expect(row!.status).toBe("open");
  });

  it("rejects task creation by a viewer", async () => {
    await expect(
      gate.runMutation(
        {
          permission: "task:create",
          idempotencyKey: "t-create-viewer",
          rawBody: "{}",
          action: "task.create",
          resourceType: "task",
          handler: (ctx) =>
            tasksOps.createTaskOp(ctx, {
              title: "nope",
              description: "",
              priority: "low",
              ownerUserId: null,
              dueDate: null,
            }),
        },
        { resolveIdentity: async () => identity(tenantA, ownerA, "viewer") },
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("assigns an in-tenant owner and updates fields", async () => {
    await gate.runMutation(
      {
        permission: "task:update",
        idempotencyKey: "t-update-1",
        rawBody: JSON.stringify({ taskId, ownerUserId: memberA }),
        action: "task.update",
        resourceType: "task",
        resourceId: () => taskId,
        handler: (ctx) =>
          tasksOps.updateTaskOp(ctx, {
            taskId,
            status: "in_progress",
            priority: "critical",
            ownerUserId: memberA,
          }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );

    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const [row] = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select().from(tasks).where(eq(tasks.id, taskId)),
    );
    expect(row!.ownerUserId).toBe(memberA);
    expect(row!.status).toBe("in_progress");
    expect(row!.priority).toBe("critical");
  });

  it("rejects assigning an owner from another tenant", async () => {
    await expect(
      gate.runMutation(
        {
          permission: "task:update",
          idempotencyKey: "t-update-badowner",
          rawBody: JSON.stringify({ taskId, ownerUserId: ownerB }),
          action: "task.update",
          resourceType: "task",
          resourceId: () => taskId,
          handler: (ctx) =>
            tasksOps.updateTaskOp(ctx, { taskId, ownerUserId: ownerB }),
        },
        { resolveIdentity: async () => identity(tenantA, ownerA) },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("completes a task and blocks re-completion", async () => {
    await gate.runMutation(
      {
        permission: "task:complete",
        idempotencyKey: `complete-task:${taskId}`,
        rawBody: JSON.stringify({ taskId }),
        action: "task.complete",
        resourceType: "task",
        resourceId: () => taskId,
        handler: (ctx) => tasksOps.completeTaskOp(ctx, { taskId }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );

    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const [row] = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select().from(tasks).where(eq(tasks.id, taskId)),
    );
    expect(row!.status).toBe("done");
    expect(row!.completedAt).not.toBeNull();

    // A re-complete under a NEW key runs the handler, which status-guards.
    await expect(
      gate.runMutation(
        {
          permission: "task:complete",
          idempotencyKey: `complete-again:${taskId}`,
          rawBody: JSON.stringify({ taskId }),
          action: "task.complete",
          resourceType: "task",
          resourceId: () => taskId,
          handler: (ctx) => tasksOps.completeTaskOp(ctx, { taskId }),
        },
        { resolveIdentity: async () => identity(tenantA, ownerA) },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("source-linked task creation is idempotent (partial unique index)", async () => {
    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const result = await withTenant(identity(tenantA, ownerA), async (tx) => {
      const ctx = { identity: identity(tenantA, ownerA), tx };
      const first = await tasksOps.createTaskFromRecommendation(ctx, {
        id: "rec-dup-test",
        type: "task",
        title: "Dup",
        detail: "Dup detail",
        confidence: 50,
      });
      const second = await tasksOps.createTaskFromRecommendation(ctx, {
        id: "rec-dup-test",
        type: "task",
        title: "Dup",
        detail: "Dup detail",
        confidence: 50,
      });
      const rows = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.sourceRef, "rec-dup-test"));
      return { first, second, count: rows.length };
    });
    expect(result.first.taskId).not.toBeNull();
    expect(result.second.taskId).toBeNull(); // conflict -> no duplicate
    expect(result.count).toBe(1);
  });

  // ----- cross-section handoff: assessment approval -> task -----

  it("approving an assessment recommendation spawns a linked task", async () => {
    const idA = identity(tenantA, ownerA);

    // create -> save best answers -> submit
    const created = await gate.runMutation(
      {
        permission: "assessment:create",
        idempotencyKey: "h-create",
        rawBody: "{}",
        action: "assessment.create",
        resourceType: "assessment",
        resourceId: (r: { id: string }) => r.id,
        handler: (ctx) =>
          aOps.createAssessmentOp(ctx, {
            name: "Handoff",
            preset: "program_submission",
            targetProgram: "Migration Competency",
          }),
      },
      { resolveIdentity: async () => idA },
    );
    const assessmentId = created.body.id;

    const answers = Object.entries(BEST).map(([questionKey, value]) => ({
      module: catalog.getQuestion(questionKey)!.module,
      questionKey,
      value,
    }));
    await gate.runMutation(
      {
        permission: "assessment:update",
        idempotencyKey: "h-save",
        rawBody: "{}",
        action: "assessment.save_responses",
        resourceType: "assessment",
        resourceId: () => assessmentId,
        handler: (ctx) => aOps.saveResponsesOp(ctx, { assessmentId, answers }),
      },
      { resolveIdentity: async () => idA },
    );
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
      { resolveIdentity: async () => idA },
    );

    const { withTenant } = db.client;
    const { assessmentRecommendations, tasks } = db.schema;
    const [rec] = await withTenant(idA, (tx) =>
      tx
        .select()
        .from(assessmentRecommendations)
        .where(eq(assessmentRecommendations.assessmentId, assessmentId)),
    );
    expect(rec!.type).toBe("program");

    const approval = await gate.runMutation(
      {
        permission: "assessment:approve",
        idempotencyKey: `approve-rec:${rec!.id}`,
        rawBody: "{}",
        action: "recommendation.approve",
        resourceType: "assessment_recommendation",
        resourceId: () => rec!.id,
        handler: (ctx) =>
          aOps.reviewRecommendationOp(ctx, {
            recommendationId: rec!.id,
            decision: "approved",
          }),
      },
      { resolveIdentity: async () => idA },
    );
    expect(approval.body.taskId).not.toBeNull();

    const [spawned] = await withTenant(idA, (tx) =>
      tx.select().from(tasks).where(eq(tasks.sourceRef, rec!.id)),
    );
    expect(spawned!.source).toBe("assessment");
    expect(spawned!.title).toBe(rec!.title);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's tasks", async () => {
    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(tasks),
    );
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging a task into another tenant", async () => {
    const { withTenant } = db.client;
    const { tasks } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(tasks).values({
          tenantId: tenantA, // forging tenant A's id from a B session
          title: "forged",
        }),
      ),
    ).rejects.toThrow();
  });
});
