import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
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
      run("mdf:update", "submit-bad", (ctx) => ops.submitRequestOp(ctx, { id: created.body.id })),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("creates an eligible request and submits it", async () => {
    const created = await run("mdf:create", "create", (ctx) => ops.createRequestOp(ctx, eligibleInput()));
    requestId = created.body.id;

    const res = await run("mdf:update", "submit", (ctx) => ops.submitRequestOp(ctx, { id: requestId }));
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
