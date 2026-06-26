import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";

/**
 * Readiness Assessments end-to-end against real Postgres: the create -> save ->
 * submit -> approve loop driven through the SAME mutation gate the server
 * actions use (so authz, idempotency, the RLS transaction, and the atomic audit
 * row are all exercised), plus the cross-tenant checks that fail if isolation
 * breaks. The operation handlers come from operations.ts — the actions' Next
 * plumbing (cookies/redirect) is not involved.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/assessments/operations");
let catalog: typeof import("@/domain/assessments/catalog");

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

/** All-best answers for the program_submission modules -> a perfect score. */
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

function buildAnswers(map: Record<string, string>) {
  return Object.entries(map).map(([questionKey, value]) => {
    const q = catalog.getQuestion(questionKey);
    if (!q) throw new Error(`unknown question ${questionKey}`);
    return { module: q.module, questionKey, value };
  });
}

let assessmentId = "";
let programRecId = "";

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/assessments/operations");
  catalog = await import("@/domain/assessments/catalog");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const [a] = await tx
      .insert(users)
      .values({
        tenantId: tenantA,
        oidcSubject: "owner-a",
        email: "owner@acme.test",
        role: "owner",
      })
      .returning({ id: users.id });
    const [b] = await tx
      .insert(users)
      .values({
        tenantId: tenantB,
        oidcSubject: "owner-b",
        email: "owner@globex.test",
        role: "owner",
      })
      .returning({ id: users.id });
    ownerA = a!.id;
    ownerB = b!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("assessments end-to-end", () => {
  it("creates a draft with its in-scope module rows", async () => {
    const res = await gate.runMutation(
      {
        permission: "assessment:create",
        idempotencyKey: "create-1",
        rawBody: JSON.stringify({ name: "Q3", preset: "program_submission" }),
        action: "assessment.create",
        resourceType: "assessment",
        resourceId: (r: { id: string }) => r.id,
        handler: (ctx) =>
          ops.createAssessmentOp(ctx, {
            name: "Q3 Readiness",
            preset: "program_submission",
            targetProgram: "Migration Competency",
          }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );
    assessmentId = res.body.id;
    expect(assessmentId).toMatch(/[0-9a-f-]{36}/);

    const { withTenant } = db.client;
    const { assessments, assessmentModules } = db.schema;
    const [row] = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select().from(assessments).where(eq(assessments.id, assessmentId)),
    );
    expect(row!.status).toBe("draft");
    expect(row!.catalogVersion).toBe(catalog.CATALOG_VERSION);

    const mods = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx
        .select()
        .from(assessmentModules)
        .where(eq(assessmentModules.assessmentId, assessmentId)),
    );
    expect(mods.map((m) => m.module).sort()).toEqual([
      "competency",
      "evidence",
      "gtm",
    ]);
  });

  it("rejects creation by a role without permission", async () => {
    await expect(
      gate.runMutation(
        {
          permission: "assessment:create",
          idempotencyKey: "create-viewer",
          rawBody: "{}",
          action: "assessment.create",
          resourceType: "assessment",
          handler: (ctx) =>
            ops.createAssessmentOp(ctx, {
              name: "nope",
              preset: "custom",
              targetProgram: null,
            }),
        },
        { resolveIdentity: async () => identity(tenantA, ownerA, "viewer") },
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("saves answers (upsert) on the draft", async () => {
    const answers = buildAnswers(BEST);
    await gate.runMutation(
      {
        permission: "assessment:update",
        idempotencyKey: "save-1",
        rawBody: JSON.stringify({ assessmentId, answers }),
        action: "assessment.save_responses",
        resourceType: "assessment",
        resourceId: () => assessmentId,
        handler: (ctx) => ops.saveResponsesOp(ctx, { assessmentId, answers }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );

    const { withTenant } = db.client;
    const { assessmentResponses } = db.schema;
    const saved = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx
        .select()
        .from(assessmentResponses)
        .where(eq(assessmentResponses.assessmentId, assessmentId)),
    );
    expect(saved).toHaveLength(Object.keys(BEST).length);
  });

  it("submits: scores every module, flips to scored, and stages recommendations", async () => {
    const res = await gate.runMutation(
      {
        permission: "assessment:submit",
        idempotencyKey: `submit:${assessmentId}`,
        rawBody: JSON.stringify({ assessmentId }),
        action: "assessment.submit",
        resourceType: "assessment",
        resourceId: () => assessmentId,
        handler: (ctx) => ops.submitAssessmentOp(ctx, { assessmentId }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );
    expect(res.body.overall).toBe(100);
    expect(res.body.recs).toBe(1); // all-best -> only the "ready to submit" program rec

    const { withTenant } = db.client;
    const { assessments, assessmentModules, assessmentRecommendations } =
      db.schema;
    const [row] = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select().from(assessments).where(eq(assessments.id, assessmentId)),
    );
    expect(row!.status).toBe("scored");
    expect(row!.overallScore).toBe(100);
    expect(row!.submittedAt).not.toBeNull();

    const mods = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx
        .select()
        .from(assessmentModules)
        .where(eq(assessmentModules.assessmentId, assessmentId)),
    );
    expect(mods.every((m) => m.score === 100)).toBe(true);

    const recs = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx
        .select()
        .from(assessmentRecommendations)
        .where(eq(assessmentRecommendations.assessmentId, assessmentId)),
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.type).toBe("program");
    expect(recs[0]!.status).toBe("pending");
    programRecId = recs[0]!.id;
  });

  it("replays a resubmit with the same key without duplicating work", async () => {
    const res = await gate.runMutation(
      {
        permission: "assessment:submit",
        idempotencyKey: `submit:${assessmentId}`,
        rawBody: JSON.stringify({ assessmentId }),
        action: "assessment.submit",
        resourceType: "assessment",
        resourceId: () => assessmentId,
        handler: (ctx) => ops.submitAssessmentOp(ctx, { assessmentId }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );
    expect(res.replayed).toBe(true);

    const { withTenant } = db.client;
    const { assessmentRecommendations } = db.schema;
    const recs = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx
        .select()
        .from(assessmentRecommendations)
        .where(eq(assessmentRecommendations.assessmentId, assessmentId)),
    );
    expect(recs).toHaveLength(1); // not re-inserted
  });

  it("status-guards a resubmit under a NEW key (already scored)", async () => {
    await expect(
      gate.runMutation(
        {
          permission: "assessment:submit",
          idempotencyKey: `submit-again:${assessmentId}`,
          rawBody: JSON.stringify({ assessmentId }),
          action: "assessment.submit",
          resourceType: "assessment",
          resourceId: () => assessmentId,
          handler: (ctx) => ops.submitAssessmentOp(ctx, { assessmentId }),
        },
        { resolveIdentity: async () => identity(tenantA, ownerA) },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("approves a recommendation and records the reviewer", async () => {
    await gate.runMutation(
      {
        permission: "assessment:approve",
        idempotencyKey: `approve-rec:${programRecId}`,
        rawBody: JSON.stringify({ recommendationId: programRecId }),
        action: "recommendation.approve",
        resourceType: "assessment_recommendation",
        resourceId: () => programRecId,
        handler: (ctx) =>
          ops.reviewRecommendationOp(ctx, {
            recommendationId: programRecId,
            decision: "approved",
          }),
      },
      { resolveIdentity: async () => identity(tenantA, ownerA) },
    );

    const { withTenant } = db.client;
    const { assessmentRecommendations } = db.schema;
    const [rec] = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx
        .select()
        .from(assessmentRecommendations)
        .where(eq(assessmentRecommendations.id, programRecId)),
    );
    expect(rec!.status).toBe("approved");
    expect(rec!.reviewedBy).toBe(ownerA);
    expect(rec!.reviewedAt).not.toBeNull();
  });

  it("rejects re-reviewing an already-reviewed recommendation", async () => {
    await expect(
      gate.runMutation(
        {
          permission: "assessment:approve",
          idempotencyKey: `reject-rec:${programRecId}`,
          rawBody: JSON.stringify({ recommendationId: programRecId }),
          action: "recommendation.reject",
          resourceType: "assessment_recommendation",
          resourceId: () => programRecId,
          handler: (ctx) =>
            ops.reviewRecommendationOp(ctx, {
              recommendationId: programRecId,
              decision: "rejected",
            }),
        },
        { resolveIdentity: async () => identity(tenantA, ownerA) },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("wrote an audit row for each mutation", async () => {
    const { withTenant } = db.client;
    const { auditLog } = db.schema;
    const actions = await withTenant(identity(tenantA, ownerA), (tx) =>
      tx.select({ action: auditLog.action }).from(auditLog),
    );
    const names = actions.map((a) => a.action);
    expect(names).toContain("assessment.create");
    expect(names).toContain("assessment.save_responses");
    expect(names).toContain("assessment.submit");
    expect(names).toContain("recommendation.approve");
  });

  // ----- cross-tenant isolation (the load-bearing RLS checks) -----

  it("tenant B cannot see tenant A's assessment", async () => {
    const { withTenant } = db.client;
    const { assessments } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(assessments),
    );
    expect(seen).toHaveLength(0);
  });

  it("tenant B submitting A's assessment id sees 'not found' (RLS hides it)", async () => {
    await expect(
      gate.runMutation(
        {
          permission: "assessment:submit",
          idempotencyKey: `b-submit:${assessmentId}`,
          rawBody: JSON.stringify({ assessmentId }),
          action: "assessment.submit",
          resourceType: "assessment",
          resourceId: () => assessmentId,
          handler: (ctx) => ops.submitAssessmentOp(ctx, { assessmentId }),
        },
        { resolveIdentity: async () => identity(tenantB, ownerB) },
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("WITH CHECK blocks forging a recommendation into another tenant", async () => {
    const { withTenant } = db.client;
    const { assessmentRecommendations } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(assessmentRecommendations).values({
          tenantId: tenantA, // forging tenant A's id from a B session
          assessmentId,
          type: "task",
          title: "forged",
          detail: "forged",
          confidence: 50,
        }),
      ),
    ).rejects.toThrow();
  });
});
