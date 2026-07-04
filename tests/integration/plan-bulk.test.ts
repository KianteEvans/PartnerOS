import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Plan-list bulk ops through the gate: assessments bulk-delete is draft-only
 * (scored rows are the historical record and always survive), roadmap
 * archive/restore is a reversible stamp — and both are RLS-bounded, so forged
 * cross-tenant ids simply never match.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let aOps: typeof import("@/domain/assessments/operations");
let rOps: typeof import("@/domain/roadmaps/operations");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";

function identity(tenantId: string, userId: string) {
  return {
    tenantId,
    userId,
    oidcSubject: `sub-${userId}`,
    epoch: 0,
    email: `${userId}@test`,
    role: "owner" as const,
  };
}

function runAs<T>(
  id: ReturnType<typeof identity>,
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "plan-bulk.test", resourceType: "assessment", handler },
    { resolveIdentity: async () => id },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  aOps = await import("@/domain/assessments/operations");
  rOps = await import("@/domain/roadmaps/operations");

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
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = inserted.find((u) => u.sub === "owner-a")!.id;
    ownerB = inserted.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

async function makeAssessment(id: ReturnType<typeof identity>, key: string): Promise<string> {
  const r = await runAs(id, "assessment:create", key, (ctx) =>
    aOps.createAssessmentOp(ctx, { name: `A-${key}`, preset: "program_submission", targetProgram: null }),
  );
  return (r.body as { id: string }).id;
}

async function makeRoadmap(id: ReturnType<typeof identity>, key: string): Promise<string> {
  const r = await runAs(id, "roadmap:create", key, (ctx) =>
    rOps.createRoadmapOp(ctx, {
      name: `R-${key}`,
      objective: "",
      horizon: "m6",
      scenario: "standard",
      startDate: "2026-07-01",
      sourceAssessmentId: null,
    }),
  );
  return (r.body as { id: string }).id;
}

describe("assessments bulk delete (draft-only)", () => {
  it("deletes drafts, skips scored, and cascades draft children", async () => {
    const id = identity(tenantA, ownerA);
    const d1 = await makeAssessment(id, "del-1");
    const d2 = await makeAssessment(id, "del-2");
    const scored = await makeAssessment(id, "del-3");
    // Test shortcut: mark one as scored without walking the submit flow.
    const { withSystem, withTenant } = db.client;
    const { assessments, assessmentModules } = db.schema;
    await withSystem(async (tx) => {
      await tx.update(assessments).set({ status: "scored" }).where(eq(assessments.id, scored));
    });

    const r = await runAs(id, "assessment:delete", "bulk-del", (ctx) =>
      aOps.bulkDeleteAssessmentsOp(ctx, { ids: [d1, d2, scored] }),
    );
    expect(r.body as { deleted: number; skipped: number }).toEqual({ deleted: 2, skipped: 1 });

    const rows = await withTenant(id, (tx) =>
      tx.select({ id: assessments.id }).from(assessments).where(inArray(assessments.id, [d1, d2, scored])),
    );
    expect(rows.map((x) => x.id)).toEqual([scored]);
    // Preset module rows for the deleted drafts are gone with the parent.
    const mods = await withTenant(id, (tx) =>
      tx
        .select({ id: assessmentModules.id })
        .from(assessmentModules)
        .where(inArray(assessmentModules.assessmentId, [d1, d2])),
    );
    expect(mods).toHaveLength(0);
  });

  it("rejects a selection with no drafts in it", async () => {
    const id = identity(tenantA, ownerA);
    const scored = await makeAssessment(id, "del-4");
    const { withSystem } = db.client;
    const { assessments } = db.schema;
    await withSystem(async (tx) => {
      await tx.update(assessments).set({ status: "scored" }).where(eq(assessments.id, scored));
    });
    await expect(
      runAs(id, "assessment:delete", "bulk-del-scored", (ctx) =>
        aOps.bulkDeleteAssessmentsOp(ctx, { ids: [scored] }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects an empty selection", async () => {
    await expect(
      runAs(identity(tenantA, ownerA), "assessment:delete", "bulk-del-empty", (ctx) =>
        aOps.bulkDeleteAssessmentsOp(ctx, { ids: [] }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("never deletes another tenant's draft", async () => {
    const bDraft = await makeAssessment(identity(tenantB, ownerB), "del-b");
    await expect(
      runAs(identity(tenantA, ownerA), "assessment:delete", "bulk-del-cross", (ctx) =>
        aOps.bulkDeleteAssessmentsOp(ctx, { ids: [bDraft] }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
    const { withTenant } = db.client;
    const { assessments } = db.schema;
    const [b] = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select({ id: assessments.id }).from(assessments).where(eq(assessments.id, bDraft)),
    );
    expect(b?.id).toBe(bDraft);
  });
});

describe("roadmaps bulk archive/restore", () => {
  it("archives then restores, stamping and clearing archived_at", async () => {
    const id = identity(tenantA, ownerA);
    const r1 = await makeRoadmap(id, "arc-1");
    const r2 = await makeRoadmap(id, "arc-2");

    const arch = await runAs(id, "roadmap:archive", "bulk-arc", (ctx) =>
      rOps.setRoadmapsArchivedOp(ctx, { ids: [r1, r2], archived: true }),
    );
    expect((arch.body as { count: number }).count).toBe(2);

    const { withTenant } = db.client;
    const { roadmaps } = db.schema;
    const archivedRows = await withTenant(id, (tx) =>
      tx.select({ archivedAt: roadmaps.archivedAt }).from(roadmaps).where(inArray(roadmaps.id, [r1, r2])),
    );
    expect(archivedRows.every((x) => x.archivedAt !== null)).toBe(true);

    const rest = await runAs(id, "roadmap:archive", "bulk-rest", (ctx) =>
      rOps.setRoadmapsArchivedOp(ctx, { ids: [r1], archived: false }),
    );
    expect((rest.body as { count: number }).count).toBe(1);
    const afterRestore = await withTenant(id, (tx) =>
      tx.select({ id: roadmaps.id, archivedAt: roadmaps.archivedAt }).from(roadmaps).where(inArray(roadmaps.id, [r1, r2])),
    );
    expect(afterRestore.find((x) => x.id === r1)?.archivedAt).toBeNull();
    expect(afterRestore.find((x) => x.id === r2)?.archivedAt).not.toBeNull();
  });

  it("rejects an empty selection", async () => {
    await expect(
      runAs(identity(tenantA, ownerA), "roadmap:archive", "bulk-arc-empty", (ctx) =>
        rOps.setRoadmapsArchivedOp(ctx, { ids: [], archived: true }),
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("never archives another tenant's roadmap", async () => {
    const bId = await makeRoadmap(identity(tenantB, ownerB), "arc-b");
    const r = await runAs(identity(tenantA, ownerA), "roadmap:archive", "bulk-arc-cross", (ctx) =>
      rOps.setRoadmapsArchivedOp(ctx, { ids: [bId], archived: true }),
    );
    expect((r.body as { count: number }).count).toBe(0);
    const { withTenant } = db.client;
    const { roadmaps } = db.schema;
    const [b] = await withTenant(identity(tenantB, ownerB), (tx) =>
      tx.select({ archivedAt: roadmaps.archivedAt }).from(roadmaps).where(eq(roadmaps.id, bId)),
    );
    expect(b?.archivedAt).toBeNull();
  });
});
