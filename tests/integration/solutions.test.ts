import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * Solutions (Tier D) end-to-end through the gate: CRUD + RLS, the rolling-12-month
 * launched-opportunity count that drives renewal readiness, the opportunity/
 * application Solution links (with the cross-tenant guard), and the application
 * Tracker "Solution attached" row flipping to met.
 */

const TODAY = "2026-06-25"; // horizon = 2025-06-25

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/solutions/operations");
let load: typeof import("@/domain/solutions/load");
let aceOps: typeof import("@/domain/ace/operations");
let appOps: typeof import("@/domain/applications/operations");
let appLoad: typeof import("@/domain/applications/load");
let packet: typeof import("@/domain/applications/packet");

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
    { permission, idempotencyKey: key, rawBody: "{}", action: "solution.test", resourceType: "solution", handler },
    { resolveIdentity: async () => who() },
  );
}

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/solutions/operations");
  load = await import("@/domain/solutions/load");
  aceOps = await import("@/domain/ace/operations");
  appOps = await import("@/domain/applications/operations");
  appLoad = await import("@/domain/applications/load");
  packet = await import("@/domain/applications/packet");

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

let solId = "";

describe("solutions", () => {
  it("creates and updates a Solution", async () => {
    const res = await run("solution:create", "sol-create", (ctx) =>
      ops.createSolutionOp(ctx, { title: "Threat Detection Platform", solutionType: "consulting_service", programType: "Competency" }),
    );
    solId = res.body.id;
    expect(solId).toBeTruthy();

    await run("solution:update", "sol-update", (ctx) =>
      ops.updateSolutionOp(ctx, {
        solutionId: solId,
        availability: "available",
        ftrStatus: "none",
        sellingProposition: "Continuous EKS threat detection.",
      }),
    );

    const list = await load.loadSolutions(idA(), TODAY);
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("Threat Detection Platform");
    expect(list[0]!.availability).toBe("available");
    // Active + advanced tier + services FTR ok, but 0 launched opps -> one gap -> at_risk.
    expect(list[0]!.band).toBe("at_risk");
    expect(list[0]!.launchedCount).toBe(0);
  });

  it("counts only launched opportunities inside the rolling 12-month window", async () => {
    const { withSystem } = db.client;
    const { opportunities } = db.schema;
    await withSystem(async (tx) => {
      await tx.insert(opportunities).values([
        // Launched inside the window -> counts.
        { tenantId: tenantA, name: "Acme launch", accountName: "Acme", stage: "launched", amount: 100000, source: "partner_originated", closeDate: "2026-01-15", solutionId: solId, createdBy: ownerA },
        // Launched but outside the window -> does not count.
        { tenantId: tenantA, name: "Old launch", accountName: "Acme", stage: "launched", amount: 50000, source: "partner_originated", closeDate: "2024-06-01", solutionId: solId, createdBy: ownerA },
        // Linked but not launched -> does not count.
        { tenantId: tenantA, name: "In progress", accountName: "Acme", stage: "committed", amount: 75000, source: "partner_originated", closeDate: "2026-03-01", solutionId: solId, createdBy: ownerA },
      ]);
    });

    const detail = await load.loadSolutionDetail(idA(), solId, TODAY);
    expect(detail!.opportunities).toHaveLength(3);
    expect(detail!.launchedCount).toBe(1);
    const launched = detail!.renewal.criteria.find((c) => c.key === "launched")!;
    expect(launched.ok).toBe(true);
    expect(detail!.renewal.band).toBe("compliant"); // all four criteria now pass

    // The list loader agrees.
    const list = await load.loadSolutions(idA(), TODAY);
    expect(list[0]!.launchedCount).toBe(1);
    expect(list[0]!.band).toBe("compliant");
  });

  it("links an opportunity to a Solution via the ACE update op", async () => {
    const { withSystem, withTenant } = db.client;
    const { opportunities } = db.schema;
    let oppId = "";
    await withSystem(async (tx) => {
      const [o] = await tx
        .insert(opportunities)
        .values({ tenantId: tenantA, name: "Unlinked", accountName: "Acme", stage: "launched", amount: 10000, source: "partner_originated", closeDate: "2026-02-01", createdBy: ownerA })
        .returning({ id: opportunities.id });
      oppId = o!.id;
    });

    await run("ace:update", "opp-link", (ctx) => aceOps.updateOpportunityOp(ctx, { id: oppId, solutionId: solId }), idA);
    const [linked] = await withTenant(idA(), (tx) =>
      tx.select({ solutionId: opportunities.solutionId }).from(opportunities).where(eq(opportunities.id, oppId)),
    );
    expect(linked!.solutionId).toBe(solId);

    // Now 2 launched-in-window opps credit the Solution.
    const detail = await load.loadSolutionDetail(idA(), solId, TODAY);
    expect(detail!.launchedCount).toBe(2);
  });

  it("attaching a Solution flips the application Tracker 'Solution attached' row to met", async () => {
    const { withSystem } = db.client;
    const { competencyApplications } = db.schema;
    let appId = "";
    await withSystem(async (tx) => {
      const [a] = await tx
        .insert(competencyApplications)
        .values({ tenantId: tenantA, name: "Sec App", competency: "Security", programType: "Competency", controlCount: 0 })
        .returning({ id: competencyApplications.id });
      appId = a!.id;
    });

    // Before: no Solution -> gap.
    const before = await appLoad.loadApplicationDetail(idA(), appId);
    expect(before!.application.solutionId).toBeNull();
    const rBefore = packet.applicationReadiness({ controlCount: 0, acceptedCount: 0, categories: "", pocName: "", pocEmail: "", caseStudyCount: 0, solutionAttached: before!.application.solutionId !== null });
    expect(rBefore.items.find((i) => i.label === "Solution attached")!.state).toBe("gap");

    await run("application:update", "app-link", (ctx) => appOps.updateApplicationOp(ctx, { applicationId: appId, solutionId: solId }), idA);

    const after = await appLoad.loadApplicationDetail(idA(), appId);
    expect(after!.application.solutionId).toBe(solId);
    expect(after!.application.solutionTitle).toBe("Threat Detection Platform");
    const rAfter = packet.applicationReadiness({ controlCount: 0, acceptedCount: 0, categories: "", pocName: "", pocEmail: "", caseStudyCount: 0, solutionAttached: after!.application.solutionId !== null });
    expect(rAfter.items.find((i) => i.label === "Solution attached")!.state).toBe("met");
  });

  it("rejects linking another tenant's opportunity to this Solution (cross-tenant guard)", async () => {
    const { withSystem } = db.client;
    const { opportunities } = db.schema;
    let oppB = "";
    await withSystem(async (tx) => {
      const [o] = await tx
        .insert(opportunities)
        .values({ tenantId: tenantB, name: "Globex opp", accountName: "Globex", stage: "launched", amount: 1000, source: "partner_originated", closeDate: "2026-02-01", createdBy: ownerB })
        .returning({ id: opportunities.id });
      oppB = o!.id;
    });
    // Tenant B trying to link Tenant A's Solution must fail the guard.
    await expect(
      run("ace:update", "opp-link-cross", (ctx) => aceOps.updateOpportunityOp(ctx, { id: oppB, solutionId: solId }), idB),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("isolates tenants (RLS)", async () => {
    expect(await load.loadSolutions(idB(), TODAY)).toHaveLength(0);
    expect(await load.loadSolutionDetail(idB(), solId, TODAY)).toBeNull();
    await expect(
      run("solution:update", "sol-update-b", (ctx) => ops.updateSolutionOp(ctx, { solutionId: solId, title: "hacked" }), idB),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });
});
