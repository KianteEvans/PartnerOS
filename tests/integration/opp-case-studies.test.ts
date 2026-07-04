import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Opportunity <-> case-study links end-to-end through the gate: attach/detach
 * (idempotent), cross-tenant FK verification, RLS isolation, and the Deal Desk
 * loader surfacing matches attached-first with reasons.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/ace/operations");
let dealDesk: typeof import("@/domain/ace/deal-desk-load");

const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let ownerA = "";
let ownerB = "";
let viewerA = "";

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
const idViewerA = () => identity(tenantA, viewerA, "viewer");

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "ace.test", resourceType: "opportunity", handler },
    { resolveIdentity: async () => who() },
  );
}

let oppA = "";
let oppB = "";
let globexStudy = "";
let vandelayStudy = "";
let initechStudy = "";
let studyB = "";

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/ace/operations");
  dealDesk = await import("@/domain/ace/deal-desk-load");

  const { withSystem } = db.client;
  const { tenants, users, opportunities, caseStudies } = db.schema;
  await withSystem(async (tx) => {
    await tx.insert(tenants).values([
      { id: tenantA, name: "Acme", slug: "acme" },
      { id: tenantB, name: "Globex", slug: "globex" },
    ]);
    const ins = await tx
      .insert(users)
      .values([
        { tenantId: tenantA, oidcSubject: "owner-a", email: "owner@acme.test", role: "owner" },
        { tenantId: tenantA, oidcSubject: "viewer-a", email: "viewer@acme.test", role: "viewer" },
        { tenantId: tenantB, oidcSubject: "owner-b", email: "owner@globex.test", role: "owner" },
      ])
      .returning({ id: users.id, sub: users.oidcSubject });
    ownerA = ins.find((u) => u.sub === "owner-a")!.id;
    viewerA = ins.find((u) => u.sub === "viewer-a")!.id;
    ownerB = ins.find((u) => u.sub === "owner-b")!.id;

    const oppIns = await tx
      .insert(opportunities)
      .values([
        {
          tenantId: tenantA,
          name: "Globex cloud migration",
          accountName: "Globex",
          stage: "qualified",
          status: "open",
          amount: 250_000,
          source: "amazon_originated",
          nextStep: "Plan the data warehouse migration workshop",
          createdBy: ownerA,
        },
        { tenantId: tenantB, name: "B Deal", accountName: "BCo", stage: "prospect", status: "open", amount: 10, createdBy: ownerB },
      ])
      .returning({ id: opportunities.id, name: opportunities.name });
    oppA = oppIns.find((o) => o.name === "Globex cloud migration")!.id;
    oppB = oppIns.find((o) => o.name === "B Deal")!.id;

    const csIns = await tx
      .insert(caseStudies)
      .values([
        {
          tenantId: tenantA,
          title: "Globex cloud migration",
          customerName: "Globex",
          outcomes: "Migration finished ahead of schedule.",
          createdBy: ownerA,
        },
        {
          tenantId: tenantA,
          title: "Vandelay analytics platform",
          customerName: "Vandelay",
          challenge: "Legacy data warehouse slowed reporting before the cloud migration.",
          solution: "Rebuilt the warehouse on Redshift during a phased cloud migration.",
          createdBy: ownerA,
        },
        {
          tenantId: tenantA,
          title: "Initech payroll records",
          customerName: "Initech",
          challenge: "Mainframe cobol payroll batches failed audits.",
          createdBy: ownerA,
        },
        { tenantId: tenantB, title: "B-only proof", customerName: "BCo", createdBy: ownerB },
      ])
      .returning({ id: caseStudies.id, title: caseStudies.title });
    globexStudy = csIns.find((c) => c.title === "Globex cloud migration")!.id;
    vandelayStudy = csIns.find((c) => c.title === "Vandelay analytics platform")!.id;
    initechStudy = csIns.find((c) => c.title === "Initech payroll records")!.id;
    studyB = csIns.find((c) => c.title === "B-only proof")!.id;
  });
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("opportunity case studies", () => {
  it("attaches a case study through the gate (createdBy stamped)", async () => {
    const res = await run("ace:update", "ocs-attach", (ctx) =>
      ops.attachOppCaseStudyOp(ctx, { opportunityId: oppA, caseStudyId: globexStudy }),
    );
    expect(res.body.id).toBeTruthy();

    const { withTenant } = db.client;
    const { opportunityCaseStudies } = db.schema;
    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(opportunityCaseStudies).where(eq(opportunityCaseStudies.opportunityId, oppA)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.caseStudyId).toBe(globexStudy);
    expect(rows[0]!.createdBy).toBe(ownerA);
  });

  it("re-attaching is idempotent (unique + onConflictDoNothing)", async () => {
    const res = await run("ace:update", "ocs-attach-2", (ctx) =>
      ops.attachOppCaseStudyOp(ctx, { opportunityId: oppA, caseStudyId: globexStudy }),
    );
    expect(res.body.id).toBeNull();

    const { withTenant } = db.client;
    const { opportunityCaseStudies } = db.schema;
    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(opportunityCaseStudies).where(eq(opportunityCaseStudies.opportunityId, oppA)),
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects a case study from another tenant", async () => {
    await expect(
      run("ace:update", "ocs-cross-cs", (ctx) => ops.attachOppCaseStudyOp(ctx, { opportunityId: oppA, caseStudyId: studyB })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("rejects an opportunity from another tenant", async () => {
    await expect(
      run("ace:update", "ocs-cross-opp", (ctx) => ops.attachOppCaseStudyOp(ctx, { opportunityId: oppB, caseStudyId: globexStudy })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("forbids viewers from attaching", async () => {
    await expect(
      run("ace:update", "ocs-viewer", (ctx) => ops.attachOppCaseStudyOp(ctx, { opportunityId: oppA, caseStudyId: vandelayStudy }), idViewerA),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);
  });

  it("deal desk surfaces matches attached-first with reasons; weak studies excluded", async () => {
    const model = await dealDesk.loadDealDesk(idA(), oppA);
    expect(model).not.toBeNull();
    expect(model!.caseStudyLibraryCount).toBe(3);

    const ids = model!.caseStudies.map((c) => c.id);
    expect(ids[0]).toBe(globexStudy); // pinned first
    expect(ids).toContain(vandelayStudy); // keyword suggestion (cloud/migration/warehouse overlap)
    expect(ids).not.toContain(initechStudy); // unrelated -> below threshold

    const pinned = model!.caseStudies[0]!;
    expect(pinned.attached).toBe(true);
    expect(pinned.reasons).toContain("Same customer");
    const suggested = model!.caseStudies.find((c) => c.id === vandelayStudy)!;
    expect(suggested.attached).toBe(false);
    expect(suggested.score).toBeGreaterThan(0);
    expect(suggested.reasons.some((r) => r.includes("shared keywords"))).toBe(true);
  });

  it("isolates tenants (RLS): B cannot load A's deal desk or see A's links", async () => {
    expect(await dealDesk.loadDealDesk(idB(), oppA)).toBeNull();

    const { withTenant } = db.client;
    const { opportunityCaseStudies } = db.schema;
    const rows = await withTenant(idB(), (tx) => tx.select().from(opportunityCaseStudies));
    expect(rows).toHaveLength(0);
  });

  it("detaches (idempotent)", async () => {
    await run("ace:update", "ocs-detach", (ctx) =>
      ops.detachOppCaseStudyOp(ctx, { opportunityId: oppA, caseStudyId: globexStudy }),
    );
    const { withTenant } = db.client;
    const { opportunityCaseStudies } = db.schema;
    const rows = await withTenant(idA(), (tx) =>
      tx
        .select()
        .from(opportunityCaseStudies)
        .where(and(eq(opportunityCaseStudies.opportunityId, oppA), eq(opportunityCaseStudies.caseStudyId, globexStudy))),
    );
    expect(rows).toHaveLength(0);

    // Second detach is a no-op, not an error.
    const again = await run("ace:update", "ocs-detach-2", (ctx) =>
      ops.detachOppCaseStudyOp(ctx, { opportunityId: oppA, caseStudyId: globexStudy }),
    );
    expect(again.body.ok).toBe(true);
  });
});
