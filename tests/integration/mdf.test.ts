import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "../helpers/embedded-pg";
import type { TestDb } from "../helpers/embedded-pg";
import type { MutationContext } from "@/gate/mutation-gate";
import type { Permission } from "@/authz/permissions";

/**
 * MDF Management end-to-end through the gate: the full funding lifecycle
 * (request -> approve -> deploy -> claim -> reimburse), the eligibility and
 * proof guardrails, the owner/admin-only approval gate, the task handoff, and
 * cross-tenant RLS.
 */

let db: TestDb;
let gate: typeof import("@/gate/mutation-gate");
let errors: typeof import("@/http/errors");
let ops: typeof import("@/domain/mdf/operations");
let load: typeof import("@/domain/mdf/load");
let planOps: typeof import("@/domain/mdf/plan-operations");

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

let requestId = "";

async function run<T>(
  permission: Permission,
  key: string,
  handler: (ctx: MutationContext) => Promise<T>,
  who = idA,
) {
  return gate.runMutation(
    { permission, idempotencyKey: key, rawBody: "{}", action: "mdf.test", resourceType: "mdf_request", handler },
    { resolveIdentity: async () => who() },
  );
}

const eligibleInput = (over: Partial<Parameters<typeof import("@/domain/mdf/operations")["createRequestOp"]>[1]> = {}) => ({
  title: "Re:Invent booth",
  activityType: "event" as const,
  requestedAmount: 10_000,
  expectedPipeline: 50_000,
  ownerUserId: ownerA,
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  claimDeadline: "2026-09-01",
  opportunityRef: "OPP-1",
  ...over,
});

beforeAll(async () => {
  db = await setupTestDb();
  gate = await import("@/gate/mutation-gate");
  errors = await import("@/http/errors");
  ops = await import("@/domain/mdf/operations");
  load = await import("@/domain/mdf/load");
  planOps = await import("@/domain/mdf/plan-operations");

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

describe("mdf end-to-end", () => {
  it("blocks submitting an ineligible request", async () => {
    const created = await run("mdf:create", "create-bad", (ctx) =>
      ops.createRequestOp(ctx, eligibleInput({ ownerUserId: null, opportunityRef: null })),
    );
    await expect(
      run("mdf:update", "submit-bad", (ctx) => ops.submitRequestOp(ctx, { id: created.body.id, today: "2026-06-23" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("creates an eligible request and submits it", async () => {
    const created = await run("mdf:create", "create", (ctx) => ops.createRequestOp(ctx, eligibleInput()));
    requestId = created.body.id;

    const res = await run("mdf:update", "submit", (ctx) => ops.submitRequestOp(ctx, { id: requestId, today: "2026-06-23" }));
    expect(res.body.status).toBe("requested");

    const { withTenant } = db.client;
    const { mdfRequests } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, requestId)));
    expect(r!.status).toBe("requested");
    expect(r!.submittedAt).not.toBeNull();
  });

  it("restricts approval to owner/admin and validates the amount", async () => {
    // A member cannot approve (lacks mdf:approve).
    await expect(
      run("mdf:approve", "approve-member", (ctx) => ops.approveRequestOp(ctx, { id: requestId, approvedAmount: 10_000, notes: "" }), () => identity(tenantA, memberA, "member")),
    ).rejects.toBeInstanceOf(errors.ForbiddenError);

    // Over-approving beyond the requested amount is rejected.
    await expect(
      run("mdf:approve", "approve-over", (ctx) => ops.approveRequestOp(ctx, { id: requestId, approvedAmount: 20_000, notes: "" })),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    const res = await run("mdf:approve", "approve", (ctx) => ops.approveRequestOp(ctx, { id: requestId, approvedAmount: 8_000, notes: "ok" }));
    expect(res.body.status).toBe("approved");

    const { withTenant } = db.client;
    const { mdfRequests } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, requestId)));
    expect(r!.approvedAmount).toBe(8_000);
    expect(r!.approvedAt).not.toBeNull();
  });

  it("deploys, requires proof before claiming, then claims and reimburses", async () => {
    await run("mdf:update", "deploy", (ctx) => ops.deployRequestOp(ctx, { id: requestId, deployedAmount: 8_000 }));

    // Claim is blocked without proof-of-performance evidence.
    await expect(
      run("mdf:update", "claim-noproof", (ctx) => ops.claimRequestOp(ctx, { id: requestId, claimedAmount: 8_000 })),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    const proof = await run("mdf:update", "proof", (ctx) => ops.stageProofEvidenceOp(ctx, { id: requestId }));
    expect(proof.body.evidenceId).not.toBeNull();

    await run("mdf:update", "claim", (ctx) => ops.claimRequestOp(ctx, { id: requestId, claimedAmount: 7_500 }));
    const res = await run("mdf:update", "reimburse", (ctx) => ops.reimburseRequestOp(ctx, { id: requestId, reimbursedAmount: 7_500 }));
    expect(res.body.status).toBe("reimbursed");

    const { withTenant } = db.client;
    const { mdfRequests, evidence } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, requestId)));
    expect(r!.status).toBe("reimbursed");
    expect(r!.claimedAmount).toBe(7_500);
    expect(r!.reimbursedAmount).toBe(7_500);

    const proofEv = await withTenant(idA(), (tx) => tx.select().from(evidence).where(eq(evidence.source, "mdf")));
    expect(proofEv).toHaveLength(1);
    expect(proofEv[0]!.evidenceType).toBe("billing");
  });

  it("guards out-of-order transitions", async () => {
    // The request is reimbursed; deploying again is not allowed.
    await expect(
      run("mdf:update", "deploy-again", (ctx) => ops.deployRequestOp(ctx, { id: requestId, deployedAmount: 1_000 })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("hands a request off to a task (idempotent)", async () => {
    const t1 = await run("mdf:update", "task", (ctx) => ops.createTaskFromRequestOp(ctx, { id: requestId }));
    expect(t1.body.taskId).not.toBeNull();
    const t2 = await run("mdf:update", "task-2", (ctx) => ops.createTaskFromRequestOp(ctx, { id: requestId }));
    expect(t2.body.taskId).toBeNull();

    const { withTenant } = db.client;
    const { tasks } = db.schema;
    const mdfTasks = await withTenant(idA(), (tx) => tx.select().from(tasks).where(eq(tasks.source, "mdf")));
    expect(mdfTasks).toHaveLength(1);
  });

  // ----- cross-tenant isolation -----

  it("tenant B cannot see tenant A's MDF requests", async () => {
    const { withTenant } = db.client;
    const { mdfRequests } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(mdfRequests));
    expect(seen).toHaveLength(0);
  });

  it("WITH CHECK blocks forging an MDF request into another tenant", async () => {
    const { withTenant } = db.client;
    const { mdfRequests } = db.schema;
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) =>
        tx.insert(mdfRequests).values({ tenantId: tenantA, title: "forged" }),
      ),
    ).rejects.toThrow();
  });
});

describe("mdf bulk actions, budget + snapshots", () => {
  // Create a fresh request and submit it so it sits in the `requested` state.
  async function makeRequested(key: string): Promise<string> {
    const created = await run("mdf:create", `bc-${key}`, (ctx) =>
      ops.createRequestOp(ctx, eligibleInput({ title: `bulk ${key}` })),
    );
    await run("mdf:update", `bs-${key}`, (ctx) => ops.submitRequestOp(ctx, { id: created.body.id, today: "2026-06-23" }));
    return created.body.id;
  }

  it("bulk-approves only requested rows, at their full requested amount", async () => {
    const a = await makeRequested("a");
    const b = await makeRequested("b");
    // c stays a draft (not requested) and must be skipped by the status guard.
    const c = await run("mdf:create", "bc-c", (ctx) => ops.createRequestOp(ctx, eligibleInput({ title: "bulk c" })));

    const res = await run("mdf:approve", "bulk-approve", (ctx) =>
      ops.bulkApproveMdfOp(ctx, { ids: [a, b, c.body.id], notes: "batch" }),
    );
    expect(res.body.count).toBe(2);

    const { withTenant } = db.client;
    const { mdfRequests } = db.schema;
    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(mdfRequests).where(inArray(mdfRequests.id, [a, b, c.body.id])),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)!.status).toBe("approved");
    expect(byId.get(a)!.approvedAmount).toBe(10_000); // full requested amount
    expect(byId.get(c.body.id)!.status).toBe("draft"); // untouched
  });

  it("bulk-rejects requested rows", async () => {
    const a = await makeRequested("r1");
    const b = await makeRequested("r2");
    const res = await run("mdf:approve", "bulk-reject", (ctx) =>
      ops.bulkRejectMdfOp(ctx, { ids: [a, b], notes: "out of budget" }),
    );
    expect(res.body.count).toBe(2);

    const { withTenant } = db.client;
    const { mdfRequests } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, a)));
    expect(r!.status).toBe("rejected");
    expect(r!.reviewNotes).toBe("out of budget");
  });

  it("bulk approve is a no-op across tenants (RLS scopes the UPDATE)", async () => {
    const a = await makeRequested("x");
    const res = await run(
      "mdf:approve",
      "bulk-cross",
      (ctx) => ops.bulkApproveMdfOp(ctx, { ids: [a], notes: "" }),
      () => identity(tenantB, ownerB),
    );
    expect(res.body.count).toBe(0);

    const { withTenant } = db.client;
    const { mdfRequests } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, a)));
    expect(r!.status).toBe("requested"); // tenant A's row is untouched
  });

  it("creates a budget and loads the active one for a date in its period", async () => {
    const res = await run("mdf:approve", "budget-create", (ctx) =>
      ops.createBudgetOp(ctx, {
        periodLabel: "Q3 2026",
        amount: 100_000,
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
      }),
    );
    expect(res.body.id).toBeTruthy();

    const active = await load.loadActiveBudget(idA(), "2026-08-15");
    expect(active?.amount).toBe(100_000);
    expect(active?.periodLabel).toBe("Q3 2026");

    const none = await load.loadActiveBudget(idA(), "2026-12-31");
    expect(none).toBeNull();
  });

  it("captures a daily MDF snapshot idempotently and reads the chronological series", async () => {
    const base = {
      requested: 0,
      approved: 50_000,
      deployed: 0,
      claimed: 10_000,
      reimbursed: 5_000,
      remaining: 40_000,
      pipeline: 0,
      roi: null,
      deadlineRisks: 2,
      openCount: 3,
    };
    await load.captureMdfSnapshot(idA(), base, "2026-06-10");
    await load.captureMdfSnapshot(idA(), { ...base, reimbursed: 6_000 }, "2026-06-10"); // same day -> upsert
    await load.captureMdfSnapshot(idA(), { ...base, reimbursed: 7_000 }, "2026-06-11");

    const { withTenant } = db.client;
    const { mdfSnapshots } = db.schema;
    const rows = await withTenant(idA(), (tx) =>
      tx.select().from(mdfSnapshots).where(eq(mdfSnapshots.tenantId, tenantA)),
    );
    expect(rows).toHaveLength(2); // two distinct days, not three inserts

    const trends = await load.loadMdfTrends(idA());
    expect(trends.reimbursed.length).toBeGreaterThanOrEqual(2);
    expect(trends.reimbursed.at(-1)).toBe(7_000); // chronological — latest day last
  });
});

describe("mdf event planner", () => {
  const TODAY = "2026-06-23";

  it("creates a plan, adds an eligible event, and converts it to a linked draft request", async () => {
    const plan = await run("mdf:create", "plan-1", (ctx) => planOps.createPlanOp(ctx, { title: "H2 demand-gen", notes: "" }));
    const item = await run("mdf:create", "item-1", (ctx) =>
      planOps.addPlanItemOp(ctx, {
        planId: plan.body.id,
        title: "Industry conference booth",
        description: "Booth at a regional cloud conference.",
        catalogKey: "industry-conference", // approved / event
        totalCost: 20_000,
        coFundPct: 50,
        expectedPipeline: 80_000,
        expectedOpportunities: 5,
        startDate: "2026-09-01",
        endDate: "2026-09-03",
        spmsId: null,
      }),
    );
    const conv = await run("mdf:create", "convert-1", (ctx) =>
      planOps.convertPlanItemToRequestOp(ctx, { id: item.body.id, today: TODAY }),
    );
    expect(conv.body.requestId).toBeTruthy();
    expect(conv.body.planId).toBe(plan.body.id);

    const { withTenant } = db.client;
    const { mdfRequests, mdfPlanItems } = db.schema;
    const [r] = await withTenant(idA(), (tx) => tx.select().from(mdfRequests).where(eq(mdfRequests.id, conv.body.requestId)));
    expect(r!.status).toBe("draft");
    expect(r!.requestedAmount).toBe(10_000); // 50% of 20k
    expect(r!.catalogKey).toBe("industry-conference");
    expect(r!.totalCost).toBe(20_000);

    const [it] = await withTenant(idA(), (tx) => tx.select().from(mdfPlanItems).where(eq(mdfPlanItems.id, item.body.id)));
    expect(it!.requestId).toBe(conv.body.requestId); // linked back
    expect(it!.activityType).toBe("event"); // derived from the catalog
  });

  it("refuses to convert a blocked (ineligible) event", async () => {
    const plan = await run("mdf:create", "plan-2", (ctx) => planOps.createPlanOp(ctx, { title: "bad plan", notes: "" }));
    const item = await run("mdf:create", "item-2", (ctx) =>
      planOps.addPlanItemOp(ctx, {
        planId: plan.body.id,
        title: "Team offsite",
        description: "Internal team retreat.",
        catalogKey: "travel", // ineligible
        totalCost: 5_000,
        coFundPct: 50,
        expectedPipeline: 0,
        expectedOpportunities: 0,
        startDate: "2026-09-01",
        endDate: "2026-09-03",
        spmsId: null,
      }),
    );
    await expect(
      run("mdf:create", "convert-2", (ctx) => planOps.convertPlanItemToRequestOp(ctx, { id: item.body.id, today: TODAY })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("submit hard-blocks a request grounded in an ineligible activity", async () => {
    const created = await run("mdf:create", "req-blocked", (ctx) =>
      ops.createRequestOp(ctx, eligibleInput({ catalogKey: "travel", totalCost: 5_000 })),
    );
    await expect(
      run("mdf:update", "submit-blocked", (ctx) => ops.submitRequestOp(ctx, { id: created.body.id, today: TODAY })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("tenant B cannot see tenant A's plans, and WITH CHECK blocks forging one", async () => {
    const { withTenant } = db.client;
    const { mdfEventPlans } = db.schema;
    const seen = await withTenant(identity(tenantB, ownerB), (tx) => tx.select().from(mdfEventPlans));
    expect(seen).toHaveLength(0);
    await expect(
      withTenant(identity(tenantB, ownerB), (tx) => tx.insert(mdfEventPlans).values({ tenantId: tenantA, title: "forged" })),
    ).rejects.toThrow();
  });

  it("bulk-converts only eligible, not-yet-converted events", async () => {
    const plan = await run("mdf:create", "bconv-plan", (ctx) => planOps.createPlanOp(ctx, { title: "bulk convert", notes: "" }));
    const mk = (key: string, catalogKey: string, totalCost: number) =>
      run("mdf:create", `bconv-${key}`, (ctx) =>
        planOps.addPlanItemOp(ctx, {
          planId: plan.body.id,
          title: `ev ${key}`,
          description: "",
          catalogKey,
          totalCost,
          coFundPct: 50,
          expectedPipeline: 10_000,
          expectedOpportunities: 1,
          startDate: "2026-09-01",
          endDate: "2026-09-03",
          spmsId: null,
        }),
      );
    const a = await mk("a", "industry-conference", 10_000);
    const b = await mk("b", "email-campaign", 8_000);
    const blocked = await mk("c", "travel", 4_000); // ineligible -> blocked

    // Pre-convert A individually so bulk must skip it.
    await run("mdf:create", "bconv-pre", (ctx) => planOps.convertPlanItemToRequestOp(ctx, { id: a.body.id, today: TODAY }));
    const res = await run("mdf:create", "bconv-all", (ctx) =>
      planOps.bulkConvertPlanItemsOp(ctx, { planId: plan.body.id, today: TODAY }),
    );
    expect(res.body.count).toBe(1); // only B (A already converted, C blocked)

    const { withTenant } = db.client;
    const { mdfPlanItems } = db.schema;
    const [bRow] = await withTenant(idA(), (tx) => tx.select().from(mdfPlanItems).where(eq(mdfPlanItems.id, b.body.id)));
    expect(bRow!.requestId).not.toBeNull();
    const [cRow] = await withTenant(idA(), (tx) => tx.select().from(mdfPlanItems).where(eq(mdfPlanItems.id, blocked.body.id)));
    expect(cRow!.requestId).toBeNull();
  });

  it("persists the activity description + SPMS id", async () => {
    const plan = await run("mdf:create", "desc-plan", (ctx) => planOps.createPlanOp(ctx, { title: "desc", notes: "" }));
    const item = await run("mdf:create", "desc-item", (ctx) =>
      planOps.addPlanItemOp(ctx, {
        planId: plan.body.id,
        title: "Described event",
        description: "A detailed marketing-plan description.",
        catalogKey: "email-campaign",
        totalCost: 5_000,
        coFundPct: 50,
        expectedPipeline: 0,
        expectedOpportunities: 0,
        startDate: null,
        endDate: null,
        spmsId: "SPMS-1",
      }),
    );
    const { withTenant } = db.client;
    const { mdfPlanItems } = db.schema;
    const [row] = await withTenant(idA(), (tx) => tx.select().from(mdfPlanItems).where(eq(mdfPlanItems.id, item.body.id)));
    expect(row!.description).toBe("A detailed marketing-plan description.");
    expect(row!.spmsId).toBe("SPMS-1");
  });
});
