import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Evidence Locker "Program Fit" end-to-end: the RLS loader ranks the catalog from a
 * tenant's evidence with correct met/partial/gap deltas (incl. expired-approved ->
 * partial); a fresh tenant reads empty; "pursue" adopts a program AND auto-links the
 * already-approved, unexpired evidence (idempotently); and a second tenant sees none
 * of the first's evidence or programs.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let pOps: typeof import("@/domain/programs/operations");
let fitLoad: typeof import("@/domain/evidence/fit-load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";

const TODAY = "2026-06-25";

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
    {
      permission,
      idempotencyKey: key,
      rawBody: "{}",
      action: "program.test",
      resourceType: "program",
      handler,
    },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  pOps = await import("@/domain/programs/operations");
  fitLoad = await import("@/domain/evidence/fit-load");

  const { withSystem } = db.client;
  const { tenants, users, evidence } = db.schema;
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

    // Tenant A evidence: three current-approved (case_study, architecture,
    // certification), one collected (security -> partial), one expired-approved
    // (reference -> renewal risk / partial, and NOT an auto-link candidate).
    await tx.insert(evidence).values([
      { tenantId: tenantA, title: "Acme migration case study", evidenceType: "case_study", status: "approved" },
      { tenantId: tenantA, title: "Reference architecture", evidenceType: "architecture", status: "approved" },
      { tenantId: tenantA, title: "SA certifications", evidenceType: "certification", status: "approved" },
      { tenantId: tenantA, title: "Security controls draft", evidenceType: "security", status: "collected" },
      { tenantId: tenantA, title: "Old self-assessment", evidenceType: "reference", status: "approved", expirationDate: "2025-01-01" },
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("evidence program-fit", () => {
  it("ranks the catalog with correct met/partial/gap deltas", async () => {
    const view = await fitLoad.loadProgramFit(idA(), TODAY);
    expect(view.hasEvidence).toBe(true);
    expect(view.fits.length).toBeGreaterThan(0);
    expect(view.adoptedKeys.size).toBe(0);

    // Sorted best-first.
    for (let i = 1; i < view.fits.length; i += 1) {
      expect(view.fits[i - 1]!.fitScore).toBeGreaterThanOrEqual(view.fits[i]!.fitScore);
    }

    const byKey = new Map(view.fits.map((f) => [f.programKey, f]));
    const migration = byKey.get("migration_competency")!;
    // case_study + architecture + certification approved -> met; reference expired -> partial.
    expect(migration.metCount).toBe(3);
    expect(migration.partialCount).toBe(1);
    expect(migration.gapCount).toBe(0);
    expect(migration.coveragePercent).toBe(88); // (1+1+1+0.5)/4
    const selfAssessment = migration.requirements.find((r) => r.key === "self_assessment")!;
    expect(selfAssessment.state).toBe("partial");
    expect(selfAssessment.reason.toLowerCase()).toContain("renew");

    // ISV Accelerate needs billing evidence we don't have -> a real gap -> lower coverage.
    const isv = byKey.get("isv_accelerate")!;
    expect(isv.gapCount).toBeGreaterThan(0);
    expect(migration.coveragePercent).toBeGreaterThan(isv.coveragePercent);

    // Summary is coherent.
    expect(view.summary.totalGaps).toBe(view.fits.reduce((s, f) => s + f.gapCount, 0));
    expect(view.summary.readyToPursue.length).toBeLessThanOrEqual(view.fits.length);
    expect(view.summary.bestNext).not.toBeNull();
  });

  it("reads empty for a tenant with no evidence", async () => {
    const view = await fitLoad.loadProgramFit(idB(), TODAY);
    expect(view.hasEvidence).toBe(false);
    expect(view.adoptedKeys.size).toBe(0);
  });

  it("pursue adopts a program and auto-links approved, unexpired evidence", async () => {
    const res = await run("program:create", "pursue-mig", async (ctx) => {
      const adopted = await pOps.adoptProgramOp(ctx, { libraryKey: "migration_competency" });
      const link = await pOps.autoLinkEvidenceForProgramOp(ctx, { programId: adopted.id, today: TODAY });
      return { id: adopted.id, linked: link.linked };
    });
    const programId = res.body.id;
    // case_study + architecture + certification are approved+current -> 3 links;
    // the expired reference is not a candidate, so self_assessment stays unlinked.
    expect(res.body.linked).toBe(3);

    const { withTenant } = db.client;
    const { programRequirements } = db.schema;
    const reqs = await withTenant(idA(), (tx) =>
      tx
        .select({ key: programRequirements.requirementKey, evidenceId: programRequirements.evidenceId })
        .from(programRequirements)
        .where(eq(programRequirements.programId, programId)),
    );
    expect(reqs).toHaveLength(4);
    const linkedKeys = reqs.filter((r) => r.evidenceId !== null).map((r) => r.key).sort();
    expect(linkedKeys).toEqual(["certified_staff", "customer_references", "technical_validation"]);
    expect(reqs.find((r) => r.key === "self_assessment")!.evidenceId).toBeNull();

    // Re-running auto-link is idempotent (only touches still-unlinked requirements).
    const again = await run("program:update", "pursue-mig-again", (ctx) =>
      pOps.autoLinkEvidenceForProgramOp(ctx, { programId, today: TODAY }),
    );
    expect(again.body.linked).toBe(0);

    // The program now shows as adopted in the fit view.
    const view = await fitLoad.loadProgramFit(idA(), TODAY);
    expect(view.adoptedKeys.has("migration_competency")).toBe(true);
  });

  it("isolates tenants (RLS): tenant B sees none of A's evidence or programs", async () => {
    const view = await fitLoad.loadProgramFit(idB(), TODAY);
    expect(view.hasEvidence).toBe(false);
    expect(view.adoptedKeys.has("migration_competency")).toBe(false);
    expect(view.adoptedKeys.size).toBe(0);
  });
});
