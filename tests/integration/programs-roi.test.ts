import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Competency ROI end-to-end through the gate: attribute opportunities to a
 * competency, the bucketing (open/won/launched, independent), the CONSERVATIVE
 * "won since achieved" influence (with the lazy COALESCE achieved_at stamp), the
 * AWS segment/team slice (opportunity_aws_team), the cross-tenant guard, RLS, and
 * the ON DELETE SET NULL cascade.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let programOps: typeof import("@/domain/programs/operations");
let aceOps: typeof import("@/domain/ace/operations");
let roiLoad: typeof import("@/domain/programs/roi-load");

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
const idA = () => identity(tenantA, ownerA);
const idB = () => identity(tenantB, ownerB);

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "program.roi.test", resourceType: "program", handler },
    { resolveIdentity: async () => who() },
  );
}

let programId = "";
let oppB = ""; // the launched/won $120k deal, attributed via the capture path

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  programOps = await import("@/domain/programs/operations");
  aceOps = await import("@/domain/ace/operations");
  roiLoad = await import("@/domain/programs/roi-load");

  const { withSystem } = db.client;
  const { tenants, users } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme", tier: "advanced" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const ins = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = ins.find((u) => u.sub === "owner-a")!.id;
    ownerB = ins.find((u) => u.sub === "owner-b")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("competency ROI", () => {
  it("adopts a competency and attributes opportunities (capture path + read-back)", async () => {
    const res = await run("program:create", "adopt-mig", (ctx) =>
      programOps.adoptProgramOp(ctx, { libraryKey: "migration_competency" }),
    );
    programId = res.body.id;
    expect(programId).toBeTruthy();

    const { withSystem } = db.client;
    const { opportunities } = db.schema;
    await withSystem(async (tx) => {
      // Four attributed directly; one (oppB) attributed via the ACE update op below.
      await tx.insert(opportunities).values([
        { tenantId: tenantA, name: "Open deal", accountName: "Acme", stage: "qualified", status: "open", amount: 30000, source: "partner_originated", closeDate: null, programId, createdBy: ownerA },
        { tenantId: tenantA, name: "Won before achieve", accountName: "Acme", stage: "committed", status: "won", amount: 70000, source: "partner_originated", closeDate: "2026-01-15", programId, createdBy: ownerA },
        { tenantId: tenantA, name: "Won no close date", accountName: "Acme", stage: "committed", status: "won", amount: 25000, source: "partner_originated", closeDate: null, programId, createdBy: ownerA },
        { tenantId: tenantA, name: "Lost deal", accountName: "Acme", stage: "closed_lost", status: "lost", amount: 9000, source: "partner_originated", closeDate: "2026-03-01", programId, createdBy: ownerA },
      ]);
      const [b] = await tx
        .insert(opportunities)
        .values({ tenantId: tenantA, name: "Won launched", accountName: "BigCo", stage: "launched", status: "won", amount: 120000, source: "amazon_originated", closeDate: "2026-04-01", createdBy: ownerA })
        .returning({ id: opportunities.id });
      oppB = b!.id;
    });

    await run("ace:update", "attr-b", (ctx) => aceOps.updateOpportunityOp(ctx, { id: oppB, programId }), idA);
    const [linked] = await db.client.withTenant(idA(), (tx) =>
      tx.select({ programId: db.schema.opportunities.programId }).from(db.schema.opportunities).where(eq(db.schema.opportunities.id, oppB)),
    );
    expect(linked!.programId).toBe(programId);
  });

  it("buckets independently and returns NULL influence before achievement", async () => {
    const detail = await roiLoad.loadProgramRoiDetail(idA(), programId);
    expect(detail).not.toBeNull();
    expect(detail!.achievedAt).toBeNull();
    const roi = detail!.roi;
    expect(roi.attributedCount).toBe(5); // incl. lost
    expect(roi.openCount).toBe(1);
    expect(roi.openTCV).toBe(30000);
    expect(roi.wonCount).toBe(3); // 70k + 25k + 120k
    expect(roi.wonTCV).toBe(215000);
    expect(roi.launchedCount).toBe(1); // the 120k deal
    expect(roi.launchedTCV).toBe(120000);
    // No achievement date yet -> influence is unknowable, not zero.
    expect(roi.influencedWonCount).toBeNull();
    expect(roi.influencedWonTCV).toBeNull();
  });

  it("stamps achieved_at once (COALESCE) and counts only post-achievement wins", async () => {
    // Achieve as of 2026-02-01.
    await run("program:update", "achieve", (ctx) =>
      programOps.updateProgramOp(ctx, { programId, status: "active", today: "2026-02-01" }),
    );
    // A later re-save must NOT move the achievement date.
    await run("program:update", "achieve-again", (ctx) =>
      programOps.updateProgramOp(ctx, { programId, status: "active", today: "2026-05-05" }),
    );

    const detail = await roiLoad.loadProgramRoiDetail(idA(), programId);
    expect(detail!.achievedAt).toBe("2026-02-01");
    // Of the 3 wins: 120k closed 2026-04-01 (after) counts; 70k closed 2026-01-15
    // (before) and 25k (no close date) do not.
    expect(detail!.roi.influencedWonCount).toBe(1);
    expect(detail!.roi.influencedWonTCV).toBe(120000);
    expect(detail!.roi.wonTCV).toBe(215000); // wonTCV still totals all wins
    expect(detail!.opportunities.find((o) => o.id === oppB)!.influencedWon).toBe(true);

    // The portfolio list loader agrees.
    const list = await roiLoad.loadProgramRoi(idA());
    const mig = list.find((p) => p.id === programId)!;
    expect(mig.roi.wonTCV).toBe(215000);
    expect(mig.roi.influencedWonTCV).toBe(120000);
  });

  it("slices the competency's deals by AWS segment/team", async () => {
    const { withSystem } = db.client;
    const { aceRelationships, opportunityAwsTeam } = db.schema;
    await withSystem(async (tx) => {
      const rels = await tx
        .insert(aceRelationships)
        .values([
          { tenantId: tenantA, name: "Dana Rep", role: "seller", accountName: "BigCo", strength: 60, email: "dana@aws.test" },
          { tenantId: tenantA, name: "Sam PSM", role: "partner_manager", accountName: "BigCo", strength: 50, email: "sam@aws.test" },
        ])
        .returning({ id: aceRelationships.id, email: aceRelationships.email });
      const dana = rels.find((r) => r.email === "dana@aws.test")!.id;
      const sam = rels.find((r) => r.email === "sam@aws.test")!.id;
      await tx.insert(opportunityAwsTeam).values([
        { tenantId: tenantA, opportunityId: oppB, relationshipId: dana, title: "aws_sales_rep" },
        { tenantId: tenantA, opportunityId: oppB, relationshipId: sam, title: "psm" },
      ]);
    });

    const detail = await roiLoad.loadProgramRoiDetail(idA(), programId);
    // Two AWS titles ride this competency's deals; both on the won $120k deal.
    expect(detail!.byRole.map((r) => r.title).sort()).toEqual(["aws_sales_rep", "psm"]);
    const salesRep = detail!.byRole.find((r) => r.title === "aws_sales_rep")!;
    expect(salesRep.closedWonTCV).toBe(120000);
    expect(detail!.reps).toHaveLength(2);
    expect(detail!.reps.every((r) => r.closedWonTCV === 120000)).toBe(true);
  });

  it("rejects attributing another tenant's opportunity to this competency (cross-tenant guard)", async () => {
    const { withSystem } = db.client;
    const { opportunities } = db.schema;
    let oppBidB = "";
    await withSystem(async (tx) => {
      const [o] = await tx
        .insert(opportunities)
        .values({ tenantId: tenantB, name: "Globex opp", accountName: "Globex", stage: "qualified", status: "open", amount: 1000, source: "partner_originated", createdBy: ownerB })
        .returning({ id: opportunities.id });
      oppBidB = o!.id;
    });
    await expect(
      run("ace:update", "attr-cross", (ctx) => aceOps.updateOpportunityOp(ctx, { id: oppBidB, programId }), idB),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("isolates tenants (RLS)", async () => {
    expect(await roiLoad.loadProgramRoi(idB())).toHaveLength(0);
    expect(await roiLoad.loadProgramRoiDetail(idB(), programId)).toBeNull();
  });

  it("preserves the deal but drops attribution when the competency is deleted (SET NULL)", async () => {
    const { withSystem } = db.client;
    const { programs, opportunities } = db.schema;
    await withSystem((tx) => tx.delete(programs).where(eq(programs.id, programId)));

    const [survivor] = await db.client.withTenant(idA(), (tx) =>
      tx.select({ id: opportunities.id, programId: opportunities.programId }).from(opportunities).where(eq(opportunities.id, oppB)),
    );
    expect(survivor!.id).toBe(oppB); // the opportunity still exists
    expect(survivor!.programId).toBeNull(); // attribution cleared

    // The competency is gone from the ROI list.
    expect((await roiLoad.loadProgramRoi(idA())).find((p) => p.id === programId)).toBeUndefined();
  });
});
