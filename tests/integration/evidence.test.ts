import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Evidence Locker end-to-end against real Postgres + the foundation's object
 * storage (LocalFsStorage stub under PARTNEROS_LOCAL_DEV). Covers the lifecycle,
 * the REAL fail-closed file path (upload -> pending -> scan webhook -> clean ->
 * download), the assessment evidence-gap -> evidence handoff, and cross-tenant
 * RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/evidence/operations");
let aOps: typeof import("@/domain/assessments/operations");
let scan: typeof import("@/storage/malware-scan");
let storage: typeof import("@/storage/s3");

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

let evidenceId = "";
let objectId = "";
const FILE_BODY = "hello evidence file";

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "evidence.test", resourceType: "evidence", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/evidence/operations");
  aOps = await import("@/domain/assessments/operations");
  scan = await import("@/storage/malware-scan");
  storage = await import("@/storage/s3");

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
  await rm(join(process.cwd(), ".stub-storage"), { recursive: true, force: true }).catch(() => {});
});

describe("evidence end-to-end", () => {
  it("creates an evidence record", async () => {
    const res = await run("evidence:create", "e-create", (ctx) =>
      ops.createEvidenceOp(ctx, {
        title: "Acme migration case study",
        evidenceType: "case_study",
        program: "Migration Competency",
        ownerUserId: null,
        dueDate: null,
        expirationDate: null,
        reusable: false,
      }),
    );
    evidenceId = res.body.id;

    const { withTenant } = db.client;
    const { evidence } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(evidence).where(eq(evidence.id, evidenceId)),
    );
    expect(row!.status).toBe("missing");
    expect(row!.evidenceType).toBe("case_study");
  });

  it("rejects creation by a viewer", async () => {
    await expect(
      run(
        "evidence:create",
        "e-create-viewer",
        (ctx) =>
          ops.createEvidenceOp(ctx, {
            title: "x",
            evidenceType: "other",
            program: null,
            ownerUserId: null,
            dueDate: null,
            expirationDate: null,
            reusable: false,
          }),
        () => identity(tenantA, ownerA, "viewer"),
      ),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("updates metadata and validates the owner is in-tenant", async () => {
    await run("evidence:update", "e-update", (ctx) =>
      ops.updateEvidenceOp(ctx, {
        evidenceId,
        ownerUserId: memberA,
        expirationDate: "2026-12-31",
        status: "collected",
      }),
    );
    const { withTenant } = db.client;
    const { evidence } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(evidence).where(eq(evidence.id, evidenceId)),
    );
    expect(row!.ownerUserId).toBe(memberA);
    expect(row!.status).toBe("collected");

    await expect(
      run("evidence:update", "e-update-bad", (ctx) =>
        ops.updateEvidenceOp(ctx, { evidenceId, ownerUserId: ownerB }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("uploads a file that stays fail-closed until scanned clean", async () => {
    const bytes = new TextEncoder().encode(FILE_BODY);
    const res = await run("evidence:update", "e-upload", (ctx) =>
      ops.uploadEvidenceFileOp(ctx, {
        evidenceId,
        fileName: "case-study.pdf",
        contentType: "application/pdf",
        bytes,
      }),
    );
    objectId = res.body.storageObjectId;

    const { withTenant } = db.client;
    const { evidence, storageObjects } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(evidence).where(eq(evidence.id, evidenceId)),
    );
    expect(row!.storageObjectId).toBe(objectId);
    expect(row!.status).toBe("in_review");
    expect(row!.fileName).toBe("case-study.pdf");

    const [obj] = await withTenant(idA(), (tx) =>
      tx.select().from(storageObjects).where(eq(storageObjects.id, objectId)),
    );
    expect(obj!.scanStatus).toBe("pending");

    // Fail-closed: not downloadable while pending.
    await expect(scan.assertObjectIsClean(idA(), objectId)).rejects.toBeInstanceOf(
      errors.ForbiddenError,
    );
  });

  it("becomes downloadable once the scan webhook reports clean", async () => {
    const raw = JSON.stringify({ objectId, verdict: "clean" });
    const sig = createHmac("sha256", process.env.MALWARE_SCAN_WEBHOOK_SECRET as string)
      .update(raw)
      .digest("hex");
    const applied = await scan.applyScanWebhook(raw, sig);
    expect(applied).toBe(true);

    await expect(scan.assertObjectIsClean(idA(), objectId)).resolves.toBeUndefined();

    // Round-trip the bytes from storage.
    const { withTenant } = db.client;
    const { storageObjects } = db.schema;
    const [obj] = await withTenant(idA(), (tx) =>
      tx.select({ key: storageObjects.objectKey }).from(storageObjects).where(eq(storageObjects.id, objectId)),
    );
    const got = await storage.getObjectStorage().get(obj!.key);
    expect(new TextDecoder().decode(got)).toBe(FILE_BODY);
  });

  it("a bad webhook signature changes nothing", async () => {
    const raw = JSON.stringify({ objectId, verdict: "infected" });
    const applied = await scan.applyScanWebhook(raw, "deadbeef");
    expect(applied).toBe(false);
    // still clean -> still downloadable
    await expect(scan.assertObjectIsClean(idA(), objectId)).resolves.toBeUndefined();
  });

  it("reviews and approves with a quality score", async () => {
    await run("evidence:review", "e-review", (ctx) =>
      ops.reviewEvidenceOp(ctx, {
        evidenceId,
        decision: "approved",
        qualityScore: 90,
        notes: "Strong reference.",
      }),
    );
    const { withTenant } = db.client;
    const { evidence } = db.schema;
    const [row] = await withTenant(idA(), (tx) =>
      tx.select().from(evidence).where(eq(evidence.id, evidenceId)),
    );
    expect(row!.status).toBe("approved");
    expect(row!.qualityScore).toBe(90);
    expect(row!.reviewedAt).not.toBeNull();
  });

  it("seeds a missing evidence record when an evidence-gap rec is approved", async () => {
    const ia = idA();
    const created = await gate.runMutation(
      {
        permission: "assessment:create",
        idempotencyKey: "ev-a-create",
        rawBody: "{}",
        action: "assessment.create",
        resourceType: "assessment",
        resourceId: (r: { id: string }) => r.id,
        handler: (ctx) =>
          aOps.createAssessmentOp(ctx, { name: "Gap source", preset: "program_submission", targetProgram: null }),
      },
      { resolveIdentity: async () => ia },
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
      { resolveIdentity: async () => ia },
    );

    const { withTenant } = db.client;
    const { assessmentRecommendations, evidence } = db.schema;
    const recs = await withTenant(ia, (tx) =>
      tx.select().from(assessmentRecommendations).where(eq(assessmentRecommendations.assessmentId, assessmentId)),
    );
    const gap = recs.find((r) => r.type === "evidence_gap")!;
    expect(gap).toBeDefined();

    const approval = await gate.runMutation(
      {
        permission: "assessment:approve",
        idempotencyKey: `approve-rec:${gap.id}`,
        rawBody: "{}",
        action: "recommendation.approve",
        resourceType: "assessment_recommendation",
        resourceId: () => gap.id,
        handler: (ctx) => aOps.reviewRecommendationOp(ctx, { recommendationId: gap.id, decision: "approved" }),
      },
      { resolveIdentity: async () => ia },
    );
    expect(approval.body.evidenceId).not.toBeNull();

    const [seeded] = await withTenant(ia, (tx) =>
      tx.select().from(evidence).where(eq(evidence.sourceRef, gap.id)),
    );
    expect(seeded!.source).toBe("assessment");
    expect(seeded!.status).toBe("missing");
    expect(seeded!.title).toBe(gap.title);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's evidence", async () => {
    const { withTenant } = db.client;
    const { evidence } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select().from(evidence),
    );
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging evidence into another tenant", async () => {
    const { withTenant } = db.client;
    const { evidence } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(evidence).values({ tenantId: tenantA, title: "forged" }),
      ),
    ).rejects.toThrow();
  });
});
